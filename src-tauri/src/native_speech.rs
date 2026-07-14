use serde::Serialize;
use std::sync::{mpsc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use windows::{
    Foundation::TypedEventHandler,
    Media::SpeechRecognition::{
        SpeechContinuousRecognitionResultGeneratedEventArgs,
        SpeechRecognitionHypothesisGeneratedEventArgs, SpeechRecognizer,
    },
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
};

struct WindowsRuntimeGuard;
impl Drop for WindowsRuntimeGuard {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}

static STOP_SENDER: OnceLock<Mutex<Option<mpsc::Sender<()>>>> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSpeechEvent {
    text: String,
    is_final: bool,
}

fn stop_sender() -> &'static Mutex<Option<mpsc::Sender<()>>> {
    STOP_SENDER.get_or_init(|| Mutex::new(None))
}

fn stop_existing() {
    if let Ok(mut sender) = stop_sender().lock() {
        if let Some(sender) = sender.take() {
            let _ = sender.send(());
        }
    }
}

#[tauri::command]
pub fn start_native_dictation(app: AppHandle) -> Result<(), String> {
    stop_existing();
    let (stop_tx, stop_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    *stop_sender()
        .lock()
        .map_err(|_| "Windows dictation could not be started.".to_string())? = Some(stop_tx);

    std::thread::spawn(move || {
        let result = (|| -> windows::core::Result<()> {
            unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
            let _runtime = WindowsRuntimeGuard;
            let recognizer = SpeechRecognizer::new()?;
            recognizer.CompileConstraintsAsync()?.join()?;
            let session = recognizer.ContinuousRecognitionSession()?;

            let hypothesis_app = app.clone();
            let hypothesis_handler =
                TypedEventHandler::new(
                    move |_,
                          args: windows::core::Ref<
                        SpeechRecognitionHypothesisGeneratedEventArgs,
                    >| {
                        if let Some(args) = args.as_ref() {
                            let text = args.Hypothesis()?.Text()?.to_string();
                            if !text.trim().is_empty() {
                                let _ = hypothesis_app.emit(
                                    "native-speech",
                                    NativeSpeechEvent {
                                        text,
                                        is_final: false,
                                    },
                                );
                            }
                        }
                        Ok(())
                    },
                );
            let hypothesis_token = recognizer.HypothesisGenerated(&hypothesis_handler)?;

            let result_app = app.clone();
            let result_handler = TypedEventHandler::new(
                move |_,
                      args: windows::core::Ref<
                    SpeechContinuousRecognitionResultGeneratedEventArgs,
                >| {
                    if let Some(args) = args.as_ref() {
                        let text = args.Result()?.Text()?.to_string();
                        if !text.trim().is_empty() {
                            let _ = result_app.emit(
                                "native-speech",
                                NativeSpeechEvent {
                                    text,
                                    is_final: true,
                                },
                            );
                        }
                    }
                    Ok(())
                },
            );
            let result_token = session.ResultGenerated(&result_handler)?;

            session.StartAsync()?.join()?;
            let _ = ready_tx.send(Ok(()));
            let _ = stop_rx.recv();
            let _ = session.StopAsync()?.join();
            let _ = session.RemoveResultGenerated(result_token);
            let _ = recognizer.RemoveHypothesisGenerated(hypothesis_token);
            let _ = recognizer.Close();
            Ok(())
        })();
        if let Err(error) = result {
            let message = format!("Windows dictation could not start: {error}");
            let _ = ready_tx.send(Err(message.clone()));
            let _ = app.emit("native-speech-error", message);
        }
    });

    ready_rx
        .recv_timeout(std::time::Duration::from_secs(12))
        .map_err(|_| "Windows dictation took too long to start.".to_string())?
}

#[tauri::command]
pub fn stop_native_dictation() {
    stop_existing();
}

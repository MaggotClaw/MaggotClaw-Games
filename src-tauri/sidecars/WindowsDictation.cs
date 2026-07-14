using System;
using System.Globalization;
using System.IO;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Threading;

internal static class WindowsDictation
{
    private static readonly object OutputLock = new object();

    private static string Escape(string value)
    {
        return value
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\r", "\\r")
            .Replace("\n", "\\n")
            .Replace("\t", "\\t");
    }

    private static void Write(string json)
    {
        lock (OutputLock)
        {
            Console.WriteLine(json);
            Console.Out.Flush();
        }
    }

    private static void WriteSpeech(string text, bool isFinal)
    {
        if (String.IsNullOrWhiteSpace(text)) return;
        Write("{\"type\":\"speech\",\"text\":\"" + Escape(text.Trim()) + "\",\"isFinal\":" + (isFinal ? "true" : "false") + "}");
    }

    public static int Main(string[] args)
    {
        try
        {
            using (SpeechRecognitionEngine recognizer = new SpeechRecognitionEngine(new CultureInfo("en-US")))
            {
                recognizer.LoadGrammar(new DictationGrammar());

                if (args.Length > 0 && args[0] == "--check")
                {
                    Write("{\"type\":\"ready\"}");
                    return 0;
                }

                if (args.Length > 0 && args[0] == "--self-test")
                {
                    RecognitionResult result;
                    using (MemoryStream audio = new MemoryStream())
                    {
                        using (SpeechSynthesizer speaker = new SpeechSynthesizer())
                        {
                            speaker.SetOutputToWaveStream(audio);
                            speaker.Speak("voice companion test");
                        }
                        audio.Position = 0;
                        recognizer.SetInputToWaveStream(audio);
                        result = recognizer.Recognize(TimeSpan.FromSeconds(10));
                    }
                    if (result == null || String.IsNullOrWhiteSpace(result.Text))
                    {
                        Write("{\"type\":\"error\",\"message\":\"The offline recognizer did not return test words.\"}");
                        return 2;
                    }
                    WriteSpeech(result.Text, true);
                    return 0;
                }

                recognizer.SpeechHypothesized += delegate(object sender, SpeechHypothesizedEventArgs eventArgs)
                {
                    WriteSpeech(eventArgs.Result.Text, false);
                };
                recognizer.SpeechRecognized += delegate(object sender, SpeechRecognizedEventArgs eventArgs)
                {
                    WriteSpeech(eventArgs.Result.Text, true);
                };
                recognizer.SpeechRecognitionRejected += delegate
                {
                    Write("{\"type\":\"notice\",\"message\":\"Windows heard sound but could not recognize the words.\"}");
                };
                ManualResetEvent recognitionStopped = new ManualResetEvent(true);
                recognizer.RecognizeCompleted += delegate
                {
                    recognitionStopped.Set();
                };
                Write("{\"type\":\"ready\"}");

                string command;
                while ((command = Console.ReadLine()) != null)
                {
                    if (command == "start")
                    {
                        recognitionStopped.Reset();
                        recognizer.SetInputToDefaultAudioDevice();
                        recognizer.RecognizeAsync(RecognizeMode.Multiple);
                        Write("{\"type\":\"listening\"}");
                    }
                    else if (command == "stop")
                    {
                        recognizer.RecognizeAsyncCancel();
                        recognitionStopped.WaitOne(2000);
                        Write("{\"type\":\"stopped\"}");
                    }
                    else if (command == "exit")
                    {
                        recognizer.RecognizeAsyncCancel();
                        recognitionStopped.WaitOne(1000);
                        break;
                    }
                }
                recognitionStopped.Dispose();
            }
            return 0;
        }
        catch (Exception error)
        {
            Write("{\"type\":\"error\",\"message\":\"" + Escape(error.Message) + "\"}");
            return 1;
        }
    }
}

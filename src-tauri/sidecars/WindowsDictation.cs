using System;
using System.IO;
using System.Reflection;
using System.Speech.AudioFormat;
using System.Speech.Synthesis;
using System.Text;
using NAudio.Wave;
using Vosk;

internal static class WindowsDictation
{
    private static readonly object OutputLock = new object();
    private static readonly object EngineLock = new object();

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

    // Vosk returns small flat JSON like {"text" : "hello world"} or {"partial" : "hel"}.
    // A dependency-free extractor avoids bundling a JSON library into the helper.
    private static string ExtractField(string json, string field)
    {
        if (String.IsNullOrEmpty(json)) return "";
        string marker = "\"" + field + "\"";
        int at = json.IndexOf(marker, StringComparison.Ordinal);
        if (at < 0) return "";
        int colon = json.IndexOf(':', at + marker.Length);
        if (colon < 0) return "";
        int quote = json.IndexOf('"', colon + 1);
        if (quote < 0) return "";
        var builder = new StringBuilder();
        for (int index = quote + 1; index < json.Length; index++)
        {
            char current = json[index];
            if (current == '\\' && index + 1 < json.Length)
            {
                char next = json[++index];
                builder.Append(next == 'n' ? '\n' : next == 't' ? '\t' : next);
            }
            else if (current == '"')
            {
                break;
            }
            else
            {
                builder.Append(current);
            }
        }
        return builder.ToString();
    }

    private static string ModelPath()
    {
        string overridePath = Environment.GetEnvironmentVariable("VOSK_MODEL_PATH");
        if (!String.IsNullOrEmpty(overridePath) && Directory.Exists(overridePath)) return overridePath;
        string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        foreach (string candidate in new[]
                 {
                     Path.Combine(exeDir, "vosk-model"),
                     Path.Combine(exeDir, "resources", "vosk-model"),
                 })
        {
            if (Directory.Exists(candidate)) return candidate;
        }
        throw new DirectoryNotFoundException("The offline speech model folder was not found next to the helper.");
    }

    private static Model LoadModel()
    {
        Vosk.Vosk.SetLogLevel(-1);
        return new Model(ModelPath());
    }

    private static int ChooseMicrophone()
    {
        int fallback = WaveIn.DeviceCount > 0 ? 0 : -1;
        for (int index = 0; index < WaveIn.DeviceCount; index++)
        {
            string name = WaveIn.GetCapabilities(index).ProductName;
            if (name.IndexOf("Realtek", StringComparison.OrdinalIgnoreCase) >= 0 ||
                name.IndexOf("Microphone Array", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return index;
            }
        }
        return fallback;
    }

    private static int Level(byte[] buffer, int count)
    {
        int peak = 0;
        for (int offset = 0; offset + 1 < count; offset += 2)
        {
            int sample = (short)(buffer[offset] | (buffer[offset + 1] << 8));
            int absolute = Math.Abs(sample);
            if (absolute > peak) peak = absolute;
        }
        return Math.Min(100, (int)Math.Round((peak / 32768.0) * 170.0));
    }

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length > 0 && args[0] == "--list-devices")
            {
                for (int index = 0; index < WaveIn.DeviceCount; index++)
                {
                    Write("{\"type\":\"device\",\"index\":" + index + ",\"message\":\"" + Escape(WaveIn.GetCapabilities(index).ProductName) + "\"}");
                }
                return 0;
            }

            Model model = LoadModel();

            if (args.Length > 0 && args[0] == "--check")
            {
                Write("{\"type\":\"ready\"}");
                return 0;
            }

            if (args.Length > 0 && args[0] == "--self-test")
            {
                // Synthesize known audio and prove the Vosk recognizer transcribes it.
                byte[] audioData;
                using (MemoryStream audio = new MemoryStream())
                {
                    using (SpeechSynthesizer speaker = new SpeechSynthesizer())
                    {
                        speaker.SetOutputToAudioStream(audio, new SpeechAudioFormatInfo(16000, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
                        speaker.Speak("voice companion test");
                    }
                    audioData = audio.ToArray();
                }
                using (VoskRecognizer recognizer = new VoskRecognizer(model, 16000.0f))
                {
                    recognizer.AcceptWaveform(audioData, audioData.Length);
                    string text = ExtractField(recognizer.FinalResult(), "text");
                    if (String.IsNullOrWhiteSpace(text))
                    {
                        Write("{\"type\":\"error\",\"message\":\"The offline recognizer did not return test words.\"}");
                        return 2;
                    }
                    WriteSpeech(text, true);
                }
                return 0;
            }

            Write("{\"type\":\"ready\"}");

            VoskRecognizer rec = null;
            WaveInEvent microphone = null;

            string command;
            while ((command = Console.ReadLine()) != null)
            {
                if (command == "start")
                {
                    int deviceNumber = ChooseMicrophone();
                    if (deviceNumber < 0) throw new InvalidOperationException("No Windows microphone is available.");
                    string deviceName = WaveIn.GetCapabilities(deviceNumber).ProductName;
                    lock (EngineLock)
                    {
                        rec = new VoskRecognizer(model, 16000.0f);
                    }
                    microphone = new WaveInEvent();
                    microphone.DeviceNumber = deviceNumber;
                    microphone.WaveFormat = new WaveFormat(16000, 16, 1);
                    microphone.BufferMilliseconds = 50;
                    microphone.NumberOfBuffers = 4;
                    microphone.DataAvailable += delegate(object sender, WaveInEventArgs eventArgs)
                    {
                        Write("{\"type\":\"level\",\"level\":" + Level(eventArgs.Buffer, eventArgs.BytesRecorded) + "}");
                        lock (EngineLock)
                        {
                            if (rec == null) return;
                            if (rec.AcceptWaveform(eventArgs.Buffer, eventArgs.BytesRecorded))
                            {
                                WriteSpeech(ExtractField(rec.Result(), "text"), true);
                            }
                            else
                            {
                                WriteSpeech(ExtractField(rec.PartialResult(), "partial"), false);
                            }
                        }
                    };
                    microphone.StartRecording();
                    Write("{\"type\":\"notice\",\"message\":\"Using microphone: " + Escape(deviceName) + "\"}");
                    Write("{\"type\":\"listening\"}");
                }
                else if (command == "stop")
                {
                    if (microphone != null)
                    {
                        microphone.StopRecording();
                        microphone.Dispose();
                        microphone = null;
                    }
                    lock (EngineLock)
                    {
                        if (rec != null)
                        {
                            WriteSpeech(ExtractField(rec.FinalResult(), "text"), true);
                            rec.Dispose();
                            rec = null;
                        }
                    }
                    Write("{\"type\":\"stopped\"}");
                }
                else if (command == "exit")
                {
                    if (microphone != null)
                    {
                        microphone.StopRecording();
                        microphone.Dispose();
                    }
                    lock (EngineLock)
                    {
                        if (rec != null) { rec.Dispose(); rec = null; }
                    }
                    break;
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            Write("{\"type\":\"error\",\"message\":\"" + Escape(error.ToString()) + "\"}");
            return 1;
        }
    }
}

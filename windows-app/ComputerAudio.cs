// Dictation from the computer's own sound: what the speakers or headphones
// play (a call's other side), taken straight from Windows (WASAPI loopback)
// instead of picked up again by the microphone through the air.
//
// The page asks for it with { computerAudio: "start" } and "stop" (see
// web-app/src/lib/computerAudio.ts). The sound goes to it as
// { computerAudio: "data", pcm } every 40 ms: mono 16-bit at 48 kHz, base64.
// Silence keeps coming while nothing plays (Windows sends nothing then), so
// the page's clock and silence auto-stop work as with a mic.

using System.Diagnostics;
using System.Runtime.InteropServices;

namespace HiChat;

sealed class ComputerAudio(Action<string> post)
{
  public const int Rate = 48000;
  /// 40 ms at 48 kHz, a multiple of 3 so the page's 16 kHz downsample divides it
  const int Block = 1920;

  /// Each start gets a number; a stop, or a newer start, ends an older capture
  volatile int generation;
  volatile bool running;

  /// Called on the window's thread only.
  public void Start()
  {
    if (running) { post(Json.Write(new Dictionary<string, object> { ["computerAudio"] = "started", ["rate"] = Rate })); return; }
    running = true;
    var gen = ++generation;
    new Thread(() => Run(gen)) { IsBackground = true, Name = "Computer audio", Priority = ThreadPriority.AboveNormal }.Start();
  }

  public void Stop()
  {
    running = false;
    generation++;
  }

  void Run(int gen)
  {
    bool Mine() => running && gen == generation;
    var told = false;
    var failures = 0;
    while (Mine())
    {
      try
      {
        Capture(Mine, () =>
        {
          failures = 0;
          if (told) return;
          told = true;
          post(Json.Write(new Dictionary<string, object> { ["computerAudio"] = "started", ["rate"] = Rate }));
        });
      }
      catch (Exception e)
      {
        // No output device, or it went away (headphones unplugged): try the
        // new default again, and give up after a few tries in a row
        if (++failures >= 5)
        {
          if (gen != generation) return;
          running = false;
          post(Json.Write(new Dictionary<string, object> { ["computerAudio"] = "failed", ["error"] = e.Message }));
          return;
        }
        Thread.Sleep(300);
      }
    }
  }

  /// Records the default output until stopped or it changes.
  void Capture(Func<bool> mine, Action started)
  {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IAudioClient? client = null;
    IntPtr format = IntPtr.Zero;
    try
    {
      Check(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eConsole, out var device));
      Check(device.GetId(out var deviceId));
      var iid = typeof(IAudioClient).GUID;
      Check(device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out var activated));
      client = (IAudioClient)activated;
      Check(client.GetMixFormat(out format));
      var mix = Marshal.PtrToStructure<WAVEFORMATEX>(format);
      var kind = SampleKind(format, mix);
      // A second of buffer: the loop below empties it every 10 ms
      Check(client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 10_000_000, 0, format, IntPtr.Zero));
      var serviceId = typeof(IAudioCaptureClient).GUID;
      Check(client.GetService(ref serviceId, out var service));
      var capture = (IAudioCaptureClient)service;
      Check(client.Start());
      started();

      var resampler = new Resampler(mix.nSamplesPerSec, Rate);
      var output = new List<float>(Block * 2);
      var clock = Stopwatch.StartNew();
      // How much sound (in 48 kHz samples) has gone to the page so far, to fill
      // the gaps Windows leaves while nothing plays
      long sent = 0;
      var lastCheck = 0L;
      while (mine())
      {
        Thread.Sleep(10);
        var got = false;
        while (true)
        {
          Check(capture.GetNextPacketSize(out var packet));
          if (packet == 0) break;
          Check(capture.GetBuffer(out var data, out var frames, out var flags, out _, out _));
          got = true;
          var mono = new float[frames];
          if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) == 0)
            ReadMono(data, (int)frames, mix.nChannels, mix.nBlockAlign, kind, mono);
          Check(capture.ReleaseBuffer(frames));
          resampler.Push(mono, output);
        }
        // Nothing played for a moment: silence until now
        var due = clock.ElapsedTicks * Rate / Stopwatch.Frequency;
        if (!got && due - sent - output.Count > Rate / 20)
          for (var n = due - sent - output.Count; n > 0; n--) output.Add(0);
        while (output.Count >= Block)
        {
          Send(output, Block);
          output.RemoveRange(0, Block);
          sent += Block;
        }
        // Ahead of the clock (Windows' timing drifts from ours): let it catch up
        if (sent > due + Rate) sent = due;
        // The default output changed (headphones in or out): follow it
        if (clock.ElapsedMilliseconds - lastCheck > 1000)
        {
          lastCheck = clock.ElapsedMilliseconds;
          if (enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eConsole, out var now) == 0)
          {
            var moved = now.GetId(out var nowId) == 0 && nowId != deviceId;
            Marshal.ReleaseComObject(now);
            if (moved) return;
          }
        }
      }
    }
    finally
    {
      try { client?.Stop(); } catch (COMException) { }
      if (format != IntPtr.Zero) Marshal.FreeCoTaskMem(format);
      if (client != null) Marshal.ReleaseComObject(client);
      Marshal.ReleaseComObject(enumerator);
    }
  }

  void Send(List<float> samples, int count)
  {
    var bytes = new byte[count * 2];
    for (var i = 0; i < count; i++)
    {
      var s = (short)Math.Round(Math.Max(-1f, Math.Min(1f, samples[i])) * 32767);
      bytes[i * 2] = (byte)s;
      bytes[i * 2 + 1] = (byte)(s >> 8);
    }
    post("{\"computerAudio\":\"data\",\"pcm\":\"" + Convert.ToBase64String(bytes) + "\"}");
  }

  enum Kind { Float32, Int16, Int24, Int32 }

  static Kind SampleKind(IntPtr format, WAVEFORMATEX mix)
  {
    var tag = mix.wFormatTag;
    if (tag == WAVE_FORMAT_EXTENSIBLE && mix.cbSize >= 22)
    {
      // The sub-format after the 18-byte header, 2-byte valid bits and 4-byte channel mask
      var sub = Marshal.PtrToStructure<Guid>(format + 24);
      tag = sub == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM;
    }
    if (tag == WAVE_FORMAT_IEEE_FLOAT && mix.wBitsPerSample == 32) return Kind.Float32;
    return mix.wBitsPerSample switch
    {
      16 => Kind.Int16,
      24 => Kind.Int24,
      32 => Kind.Int32,
      _ => throw new InvalidOperationException($"Unsupported sound format ({mix.wBitsPerSample}-bit)"),
    };
  }

  /// The channels averaged into one.
  static unsafe void ReadMono(IntPtr data, int frames, int channels, int blockAlign, Kind kind, float[] mono)
  {
    var p = (byte*)data;
    var width = blockAlign / Math.Max(1, channels);
    for (var f = 0; f < frames; f++)
    {
      float sum = 0;
      for (var c = 0; c < channels; c++)
      {
        var s = p + f * blockAlign + c * width;
        sum += kind switch
        {
          Kind.Float32 => *(float*)s,
          Kind.Int16 => *(short*)s / 32768f,
          Kind.Int24 => ((s[0] << 8) | (s[1] << 16) | (s[2] << 24)) / 2147483648f,
          _ => *(int*)s / 2147483648f,
        };
      }
      mono[f] = sum / channels;
    }
  }

  /// Linear resampling to 48 kHz (most outputs already are; some run at 44.1).
  sealed class Resampler(uint from, int to)
  {
    readonly double step = (double)from / to;
    double pos;
    float last;

    public void Push(float[] input, List<float> output)
    {
      if (from == to) { output.AddRange(input); return; }
      // pos runs from -1 (the last sample of the previous packet) on
      while (pos < input.Length - 1)
      {
        var i = (int)Math.Floor(pos);
        var t = (float)(pos - i);
        var a = i < 0 ? last : input[i];
        var b = input[i + 1];
        output.Add(a + (b - a) * t);
        pos += step;
      }
      if (input.Length > 0) last = input[input.Length - 1];
      pos -= input.Length;
    }
  }

  static void Check(int hr) { if (hr < 0) Marshal.ThrowExceptionForHR(hr); }

  // MARK: WASAPI

  const int CLSCTX_ALL = 0x17;
  const int AUDCLNT_SHAREMODE_SHARED = 0;
  const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
  const uint AUDCLNT_BUFFERFLAGS_SILENT = 2;
  const ushort WAVE_FORMAT_PCM = 1, WAVE_FORMAT_IEEE_FLOAT = 3, WAVE_FORMAT_EXTENSIBLE = 0xFFFE;
  static readonly Guid KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new("00000003-0000-0010-8000-00aa00389b71");

  enum EDataFlow { eRender, eCapture, eAll }
  enum ERole { eConsole, eMultimedia, eCommunications }

  [StructLayout(LayoutKind.Sequential, Pack = 2)]
  struct WAVEFORMATEX
  {
    public ushort wFormatTag, nChannels;
    public uint nSamplesPerSec, nAvgBytesPerSec;
    public ushort nBlockAlign, wBitsPerSample, cbSize;
  }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumerator { }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator
  {
    [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice
  {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    [PreserveSig] int OpenPropertyStore(int access, out IntPtr properties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }

  [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioClient
  {
    [PreserveSig] int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr audioSessionGuid);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint frames);
    [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr handle);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
  }

  [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioCaptureClient
  {
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint frames);
  }
}

// What .NET Framework 4.8 lacks that Hi-chat used from .NET 8: small
// stand-ins, so HiChat.cs reads much as it did.

using System.Diagnostics;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

namespace HiChat
{
  static class Compat
  {
    /// This Hi-chat.exe (Environment.ProcessPath)
    public static string ExePath => Application.ExecutablePath;

    public static int ProcessId { get; } = Process.GetCurrentProcess().Id;

    /// Milliseconds on a clock that never jumps or wraps (Environment.TickCount64)
    public static long TickCount64 => Stopwatch.GetTimestamp() / (Stopwatch.Frequency / 1000);

    public static int Clamp(int value, int min, int max) => value < min ? min : value > max ? max : value;

    public static T[] Values<T>() where T : struct, Enum => (T[])Enum.GetValues(typeof(T));

    public static TValue GetValueOrDefault<TKey, TValue>(this IReadOnlyDictionary<TKey, TValue> d, TKey key, TValue fallback) =>
      d.TryGetValue(key, out var v) ? v : fallback;
  }

  /// JSON with what .NET Framework has built in (System.Web.Extensions).
  static class Json
  {
    static JavaScriptSerializer New() => new() { MaxJsonLength = int.MaxValue, RecursionLimit = 64 };

    public static string Write(object? value) => New().Serialize(value);

    public static T? Read<T>(string text) => New().Deserialize<T>(text);

    /// Objects come back as Dictionary&lt;string, object&gt;, arrays as
    /// object[] (or ArrayList), strings, bools and numbers as themselves.
    public static object? Parse(string text) =>
      text.Trim() == "null" ? null : New().DeserializeObject(text); // a bare null is too much for it

    public static IDictionary<string, object>? Object(object? value) => value as IDictionary<string, object>;

    public static IEnumerable<object> Array(object? value) =>
      value is System.Collections.IEnumerable list and not string ? list.Cast<object>() : Enumerable.Empty<object>();

    public static object? Get(IDictionary<string, object>? o, string key) =>
      o != null && o.TryGetValue(key, out var v) ? v : null;

    public static string? String(IDictionary<string, object>? o, string key) =>
      o != null && o.TryGetValue(key, out var v) ? v as string : null;

    public static bool True(IDictionary<string, object>? o, string key) =>
      o != null && o.TryGetValue(key, out var v) && v is true;

    public static double? Number(object? v) => v switch
    {
      int i => i,
      long l => l,
      decimal m => (double)m,
      double d => d,
      _ => null,
    };
  }

  /// ECDSA P-256 checks with Windows' own crypto (CNG): .NET Framework can't
  /// read a public key in the usual (SubjectPublicKeyInfo) form or a
  /// DER-encoded signature, so both are taken apart here.
  static class P256
  {
    // The fixed start of a P-256 SubjectPublicKeyInfo, then 0x04 || X || Y
    static readonly byte[] SpkiPrefix = Convert.FromBase64String("MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE");

    public static bool Verify(byte[] spki, byte[] data, byte[] derSignature)
    {
      if (spki.Length != SpkiPrefix.Length + 64 || !spki.Take(SpkiPrefix.Length).SequenceEqual(SpkiPrefix)) return false;
      if (Raw(derSignature) is not { } signature) return false;
      // BCRYPT_ECCPUBLIC_BLOB: "ECS1", 32 (bytes per coordinate), X, Y
      var blob = new byte[8 + 64];
      BitConverter.GetBytes(0x31534345).CopyTo(blob, 0);
      BitConverter.GetBytes(32).CopyTo(blob, 4);
      Buffer.BlockCopy(spki, SpkiPrefix.Length, blob, 8, 64);
      using var key = CngKey.Import(blob, CngKeyBlobFormat.EccPublicBlob);
      using var ecdsa = new ECDsaCng(key) { HashAlgorithm = CngAlgorithm.Sha256 };
      return ecdsa.VerifyData(data, signature);
    }

    /// SEQUENCE { INTEGER r, INTEGER s } to r || s, 32 bytes each.
    static byte[]? Raw(byte[] der)
    {
      var at = 0;
      if (!Expect(der, ref at, 0x30, out var seqLength) || at + seqLength != der.Length) return null;
      var raw = new byte[64];
      for (var part = 0; part < 2; part++)
      {
        if (!Expect(der, ref at, 0x02, out var length) || at + length > der.Length) return null;
        var start = at;
        var n = length;
        while (n > 32 && der[start] == 0) { start++; n--; } // a leading 0 keeps it positive
        if (n > 32) return null;
        Buffer.BlockCopy(der, start, raw, part * 32 + (32 - n), n);
        at += length;
      }
      return at == der.Length ? raw : null;
    }

    static bool Expect(byte[] der, ref int at, byte tag, out int length)
    {
      length = 0;
      if (at + 2 > der.Length || der[at++] != tag) return false;
      int first = der[at++];
      if (first < 0x80) { length = first; return true; }
      var count = first & 0x7F;
      if (count is < 1 or > 2 || at + count > der.Length) return false;
      for (var i = 0; i < count; i++) length = (length << 8) | der[at++];
      return true;
    }
  }

  /// Packs WebView2's DLLs inside Hi-chat.exe, so it stays one file that
  /// installs and updates itself: the two .NET ones load straight from the
  /// exe, and the native loader is written next to Hi-chat's data, once per
  /// version, and only used when its bytes are exactly the packed ones.
  static class Packed
  {
    static readonly Dictionary<string, System.Reflection.Assembly> loaded = new();

    public static void Use()
    {
      AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
      {
        var name = new System.Reflection.AssemblyName(e.Name).Name + ".dll";
        lock (loaded)
        {
          // Each DLL is loaded once: a second copy's types wouldn't match the first's
          if (loaded.TryGetValue(name, out var known)) return known;
          if (Read(name) is not { } bytes) return null;
          return loaded[name] = System.Reflection.Assembly.Load(bytes);
        }
      };
    }

    /// Writes WebView2Loader.dll where WebView2 will look for it; the folder, or null.
    public static string? LoaderFolder()
    {
      var bytes = Read("WebView2Loader.dll");
      if (bytes == null) return null;
      try
      {
        var all = Path.Combine(App.DataDir, "webview2-loader");
        var folder = Path.Combine(all, App.Version);
        var file = Path.Combine(folder, "WebView2Loader.dll");
        if (!File.Exists(file) || !File.ReadAllBytes(file).SequenceEqual(bytes))
        {
          Directory.CreateDirectory(folder);
          File.WriteAllBytes(file, bytes);
        }
        // Older versions' copies
        foreach (var other in Directory.GetDirectories(all))
          if (!string.Equals(other, folder, StringComparison.OrdinalIgnoreCase))
            try { Directory.Delete(other, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        return folder;
      }
      catch (Exception e)
      {
        Debug.WriteLine($"Hi-chat: WebView2 loader not written: {e.Message}");
        return null;
      }
    }

    static byte[]? Read(string name)
    {
      using var stream = typeof(Packed).Assembly.GetManifestResourceStream(name);
      if (stream == null) return null;
      using var copy = new MemoryStream();
      stream.CopyTo(copy);
      return copy.ToArray();
    }
  }
}

namespace System
{
  // What C# needs for ranges (s[1..]) and list patterns (["hold", var m])
  readonly struct Index
  {
    readonly int value;
    public Index(int value, bool fromEnd = false) => this.value = fromEnd ? ~value : value;
    public int Value => value < 0 ? ~value : value;
    public bool IsFromEnd => value < 0;
    public int GetOffset(int length) => IsFromEnd ? length - Value : Value;
    public static implicit operator Index(int value) => new(value);
    public static Index Start => new(0);
    public static Index End => new(0, true);
  }

  readonly struct Range
  {
    public Index Start { get; }
    public Index End { get; }
    public Range(Index start, Index end) { Start = start; End = end; }
    public static Range StartAt(Index start) => new(start, Index.End);
    public static Range EndAt(Index end) => new(Index.Start, end);
    public static Range All => new(Index.Start, Index.End);
    public (int Offset, int Length) GetOffsetAndLength(int length)
    {
      var start = Start.GetOffset(length);
      var end = End.GetOffset(length);
      if ((uint)end > (uint)length || (uint)start > (uint)end) throw new ArgumentOutOfRangeException(nameof(length));
      return (start, end - start);
    }
  }
}

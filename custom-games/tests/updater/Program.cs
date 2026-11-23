using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TacticalMapWarGame;

byte[] installer = Encoding.UTF8.GetBytes("installer fixture");
string digest = Convert.ToHexString(SHA256.HashData(installer)).ToLowerInvariant();
string assetUrl = "https://github.com/arowcarter/arowcarter/releases/download/tactical-game-v1.4.2/TacticalMapWarGameSetup.msi";
string Release(string url, string hash) => JsonSerializer.Serialize(new[] {
    new { tag_name = "unrelated-v99.0.0", draft = false, prerelease = false, assets = Array.Empty<object>() },
    new { tag_name = "tactical-game-v1.4.2", draft = false, prerelease = false, assets = new object[] {
        new { name = "TacticalMapWarGameSetup.msi", browser_download_url = url, size = installer.Length, digest = hash }
    } }
});
var handler = new FakeHandler { Releases = Release(assetUrl, "sha256:" + digest), Data = installer };
using var client = new HttpClient(handler);
var service = new UpdateService(client);
GameUpdate? update = await service.FindUpdateAsync(new Version(1, 4, 1), CancellationToken.None);
if (update?.Version != new Version(1, 4, 2)) throw new Exception("Newer release not found.");
if (await service.FindUpdateAsync(new Version(1, 4, 2), CancellationToken.None) != null)
    throw new Exception("An installed release was reported as newer.");
string path = await service.DownloadAsync(update, null, CancellationToken.None);
if (!File.ReadAllBytes(path).SequenceEqual(installer)) throw new Exception("Installer download changed.");
File.Delete(path);
Directory.Delete(Path.GetDirectoryName(path)!);

handler.Releases = Release("https://example.com/installer.msi", "sha256:" + digest);
try { await service.FindUpdateAsync(new Version(1, 4, 1), CancellationToken.None); throw new Exception("Unsafe URL accepted."); }
catch (InvalidDataException) { }
handler.Releases = Release(assetUrl, "sha256:" + digest);
handler.Data = Encoding.UTF8.GetBytes("corrupted fixture");
try { await service.DownloadAsync(update, null, CancellationToken.None); throw new Exception("Corrupt download accepted."); }
catch (InvalidDataException) { }
Console.WriteLine("Updater release selection, download, URL validation and integrity checks passed.");

sealed class FakeHandler : HttpMessageHandler
{
    public required string Releases { get; set; }
    public required byte[] Data { get; set; }
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = request.RequestUri!.Host == "api.github.com"
                ? new StringContent(Releases, Encoding.UTF8, "application/json")
                : new ByteArrayContent(Data)
        };
        return Task.FromResult(response);
    }
}

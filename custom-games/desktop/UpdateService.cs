using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TacticalMapWarGame;

internal sealed record GameUpdate(Version Version, Uri DownloadUrl, long Size, string Sha256);

internal sealed class UpdateService(HttpClient client)
{
    private const string ApiBase = "https://api.github.com/repos/arowcarter/arowcarter/releases";
    private const string AssetName = "TacticalMapWarGameSetup.msi";
    private const long MaxInstallerSize = 250L * 1024 * 1024;
    private static readonly Regex TagPattern = new(@"^tactical-game-v(\d+\.\d+\.\d+)$",
        RegexOptions.CultureInvariant);

    public async Task<GameUpdate?> FindUpdateAsync(Version current, CancellationToken cancellationToken)
    {
        GameUpdate? newest = null;
        for (int page = 1; ; page++)
        {
            using var response = await client.GetAsync($"{ApiBase}?per_page=100&page={page}", cancellationToken);
            response.EnsureSuccessStatusCode();
            using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
            if (document.RootElement.ValueKind != JsonValueKind.Array)
                throw new InvalidDataException("GitHub returned an invalid release list.");

            int count = 0;
            foreach (JsonElement release in document.RootElement.EnumerateArray())
            {
                count++;
                if (release.GetProperty("draft").GetBoolean() || release.GetProperty("prerelease").GetBoolean()) continue;
                string tag = release.GetProperty("tag_name").GetString() ?? "";
                Match match = TagPattern.Match(tag);
                if (!match.Success || !Version.TryParse(match.Groups[1].Value, out Version? version) ||
                    version <= current || (newest != null && version <= newest.Version)) continue;

                JsonElement? asset = null;
                foreach (JsonElement item in release.GetProperty("assets").EnumerateArray())
                    if (item.GetProperty("name").GetString() == AssetName) { asset = item; break; }
                if (asset == null) throw new InvalidDataException($"Release {tag} has no installer.");

                string url = asset.Value.GetProperty("browser_download_url").GetString() ?? "";
                string expectedUrl = $"https://github.com/arowcarter/arowcarter/releases/download/{tag}/{AssetName}";
                long size = asset.Value.GetProperty("size").GetInt64();
                string digest = asset.Value.TryGetProperty("digest", out JsonElement digestValue)
                    ? digestValue.GetString() ?? "" : "";
                if (url != expectedUrl || size <= 0 || size > MaxInstallerSize ||
                    !Regex.IsMatch(digest, "^sha256:[0-9a-fA-F]{64}$", RegexOptions.CultureInvariant))
                    throw new InvalidDataException($"Release {tag} has invalid installer metadata.");
                newest = new GameUpdate(version, new Uri(url), size, digest[7..]);
            }
            if (count < 100) return newest;
        }
    }

    public async Task<string> DownloadAsync(GameUpdate update, IProgress<long>? progress, CancellationToken cancellationToken)
    {
        string directory = Path.Combine(Path.GetTempPath(), "TacticalMapWarGame", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, AssetName);
        try
        {
            using var response = await client.GetAsync(update.DownloadUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();
            await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
            await using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            byte[] buffer = new byte[81920];
            long total = 0;
            int read;
            while ((read = await input.ReadAsync(buffer, cancellationToken)) > 0)
            {
                total += read;
                if (total > update.Size || total > MaxInstallerSize)
                    throw new InvalidDataException("The update is larger than advertised.");
                hash.AppendData(buffer, 0, read);
                await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                progress?.Report(total);
            }
            string actual = Convert.ToHexString(hash.GetHashAndReset());
            if (total != update.Size || !actual.Equals(update.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("The downloaded update failed its integrity check.");
            return path;
        }
        catch
        {
            if (File.Exists(path)) File.Delete(path);
            Directory.Delete(directory);
            throw;
        }
    }
}

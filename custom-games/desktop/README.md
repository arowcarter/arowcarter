# Windows desktop app

Run `dist\TacticalMapWarGameSetup.msi` to install the game. Choose an installation folder (the default is `C:\Program Files\Tactical Map War Game`) and whether to create a desktop game shortcut for the installing user. The game shortcut is selected by default. Launch the game from the Start menu or the desktop shortcut. The installer targets 64-bit Windows and requires administrator permission.

Uninstall using **Uninstall Tactical Map War Game** on the installing user's desktop or Windows Settings. The uninstall shortcut is created even if the optional desktop game shortcut is disabled. The included NYC map is installed in the selected folder under `Maps\nyc map.txt`; load it with the game's Map button.

The application requires the Microsoft Edge WebView2 Runtime. It also needs internet access to load its interface resources and use online multiplayer. Both players should install version 1.3.0 or newer to share large maps. Games remain in memory and are not saved across app restarts.

For unattended installation, `msiexec /i TacticalMapWarGameSetup.msi /qn INSTALLFOLDER="C:\Games\Tactical Map War Game" CREATE_DESKTOP_SHORTCUT=0` selects a folder and omits the desktop game shortcut.

To build the installer on Windows, install the .NET 8 SDK and run:

```cmd
build-installer.cmd
```

The script restores the locally pinned WiX tool, WiX UI extension, and WebView2 dependency and publishes a self-contained app. Output is written to `dist\`. The MSI is unsigned; Windows may display a publisher warning.

## Publishing updates

The updater-enabled installer must be installed once on each computer. The game
then checks GitHub Releases on startup; **Game > Check for updates** also checks
manually. With the player's consent, it downloads and verifies the installer,
closes the game, and opens Windows Installer. Installation still requires
administrator approval. Existing installers do not contain this updater.

Edit the values in `game\balance\`, commit the changes, and merge them into
`main`. The **Publish Tactical Map War Game** GitHub Actions workflow builds and
publishes a versioned release automatically. It can also be started manually in
Actions. GitHub Actions must be enabled and permitted to write releases in this
public repository; until the workflow is on `main` and a release succeeds, there
is no hosted update to download. Do not edit an already published release: each
change needs a new, higher version. Players may decline an update; both players
must use matching balance files to connect.

For manual release builds, set `GAME_VERSION` to a higher three-part version
before running `build-installer.cmd`. The installer and application versions
are built from the same value.

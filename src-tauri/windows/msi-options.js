var startupKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\PLC Pilot";
var approvedKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run\\PLC Pilot";
var desktopPreferenceKey = "HKCU\\Software\\plcpilot\\PLC Pilot\\CreateDesktopShortcut";

function readValue(shell, key) {
    try { return shell.RegRead(key); }
    catch (error) {
        if ((error.number & 65535) != 2 && (error.number & 65535) != 3) throw error;
        return null;
    }
}

function deleteValue(shell, key) {
    if (readValue(shell, key) !== null) shell.RegDelete(key);
}

function executablePath() {
    var files = new ActiveXObject("Scripting.FileSystemObject");
    return files.BuildPath(Session.Property("INSTALLDIR"), "plc-pilot.exe");
}

function readInstallOptions() {
    var shell = new ActiveXObject("WScript.Shell");
    var existing = readValue(shell, startupKey);
    var desktopPreference = readValue(shell, desktopPreferenceKey);
    if (desktopPreference !== null) Session.Property("PLC_CREATE_DESKTOP") = desktopPreference ? "1" : "";
    Session.Property("PLC_STARTUP_PRESENT") = existing ? "1" : "";
    var enabled = Boolean(existing);
    var approved = readValue(shell, approvedKey);
    if (approved !== null) {
        var bytes = new VBArray(approved).toArray();
        for (var i = Math.max(0, bytes.length - 8); i < bytes.length; i++) {
            if (bytes[i] !== 0) enabled = false;
        }
    }
    Session.Property("PLC_AUTOSTART") = enabled ? "1" : "";
    return 1;
}

function applyInstallOptions() {
    var shell = new ActiveXObject("WScript.Shell");
    if (Session.Property("PLC_AUTOSTART") === "1") shell.RegWrite(startupKey, '"' + executablePath() + '"', "REG_SZ");
    else deleteValue(shell, startupKey);
    deleteValue(shell, approvedKey);
    shell.RegWrite(desktopPreferenceKey, Session.Property("PLC_CREATE_DESKTOP") === "1" ? 1 : 0, "REG_DWORD");
    if (Session.Property("PLC_CREATE_DESKTOP") === "1") {
        var files = new ActiveXObject("Scripting.FileSystemObject");
        var commonShortcut = files.BuildPath(shell.SpecialFolders("AllUsersDesktop"), "PLC Pilot.lnk");
        if (files.FileExists(commonShortcut) && shell.CreateShortcut(commonShortcut).TargetPath.toLowerCase() === executablePath().toLowerCase()) return 1;
        var shortcutPath = files.BuildPath(shell.SpecialFolders("Desktop"), "PLC Pilot.lnk");
        if (files.FileExists(shortcutPath) && shell.CreateShortcut(shortcutPath).TargetPath.toLowerCase() !== executablePath().toLowerCase()) return 1;
        var shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath = executablePath();
        shortcut.WorkingDirectory = Session.Property("INSTALLDIR");
        shortcut.IconLocation = executablePath() + ",0";
        shortcut.Save();
    }
    return 1;
}

function restoreStartup() {
    var shell = new ActiveXObject("WScript.Shell");
    shell.RegWrite(startupKey, '"' + executablePath() + '"', "REG_SZ");
    return 1;
}

function removeStartup() {
    var shell = new ActiveXObject("WScript.Shell");
    var files = new ActiveXObject("Scripting.FileSystemObject");
    var current = readValue(shell, startupKey);
    if (current && current.replace(/^\s*"|"\s*$/g, "").toLowerCase() === executablePath().toLowerCase()) {
        deleteValue(shell, startupKey);
        deleteValue(shell, approvedKey);
    }
    var shortcutPath = files.BuildPath(shell.SpecialFolders("Desktop"), "PLC Pilot.lnk");
    if (files.FileExists(shortcutPath) && shell.CreateShortcut(shortcutPath).TargetPath.toLowerCase() === executablePath().toLowerCase()) files.DeleteFile(shortcutPath);
    return 1;
}

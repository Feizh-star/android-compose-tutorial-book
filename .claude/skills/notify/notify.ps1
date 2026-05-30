param(
    [string]$Title = "Claude Code",
    [string]$Message = "任务已完成"
)

# Try native WinRT toast notification
try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $texts = $template.GetElementsByTagName("text")
    $texts.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
    $texts.Item(1).AppendChild($template.CreateTextNode($Message)) | Out-Null

    $toast = New-Object Windows.UI.Notifications.ToastNotification $template
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Claude Code").Show($toast)
    exit 0
} catch {}

# Fallback: WScript popup (auto-closes after 5 seconds)
try {
    $wshell = New-Object -ComObject WScript.Shell
    $wshell.Popup($Message, 5, $Title, 64) | Out-Null
} catch {
    Write-Host "$Title : $Message"
}

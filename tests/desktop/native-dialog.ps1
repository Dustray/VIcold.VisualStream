param(
  [Parameter(Mandatory = $true)][int]$AppProcessId,
  [string]$SelectedPath,
  [switch]$Cancel
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class VisualStreamFileDialog {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr parameter, string value);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr window, uint message, IntPtr parameter, IntPtr value);
  public static IntPtr FindEdit(IntPtr parent) {
    IntPtr edit = FindWindowEx(parent, IntPtr.Zero, "Edit", null);
    if (edit != IntPtr.Zero) return edit;
    IntPtr combo = FindWindowEx(parent, IntPtr.Zero, "ComboBox", null);
    return combo == IntPtr.Zero ? IntPtr.Zero : FindWindowEx(combo, IntPtr.Zero, "Edit", null);
  }
}
"@
$automation = [System.Windows.Automation.AutomationElement]
$treeScope = [System.Windows.Automation.TreeScope]
$processCondition = [System.Windows.Automation.PropertyCondition]::new($automation::ProcessIdProperty, $AppProcessId)
$dialogCondition = [System.Windows.Automation.PropertyCondition]::new($automation::ClassNameProperty, '#32770')
$condition = [System.Windows.Automation.AndCondition]::new($processCondition, $dialogCondition)
$deadline = [DateTime]::UtcNow.AddSeconds(20)
$dialog = $null
while ([DateTime]::UtcNow -lt $deadline) {
  $dialog = $automation::RootElement.FindFirst($treeScope::Descendants, $condition)
  if ($dialog) { break }
  Start-Sleep -Milliseconds 150
}
if (-not $dialog) { throw 'VisualStream file dialog did not appear.' }

if (-not $Cancel) {
  $filenameCondition = [System.Windows.Automation.PropertyCondition]::new($automation::AutomationIdProperty, '1148')
  $hostCondition = [System.Windows.Automation.PropertyCondition]::new($automation::AutomationIdProperty, 'FileNameControlHost')
  $editCondition = [System.Windows.Automation.PropertyCondition]::new($automation::ClassNameProperty, 'Edit')
  $filenameControl = $null
  $filenameDeadline = [DateTime]::UtcNow.AddSeconds(10)
  while ([DateTime]::UtcNow -lt $filenameDeadline) {
    $filenameControl = $dialog.FindFirst($treeScope::Descendants, $filenameCondition)
    if (-not $filenameControl) {
      $filenameHost = $dialog.FindFirst($treeScope::Descendants, $hostCondition)
      if ($filenameHost) { $filenameControl = $filenameHost.FindFirst($treeScope::Descendants, $editCondition) }
    }
    if ($filenameControl) { break }
    Start-Sleep -Milliseconds 150
  }
  if (-not $filenameControl) { throw "File name control was not found in $($dialog.Current.Name)." }
  $valuePattern = $null
  if ($filenameControl.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
    $valuePattern.SetValue($SelectedPath)
  } else {
    $controlHandle = [IntPtr]$filenameControl.Current.NativeWindowHandle
    $editHandle = if ($filenameControl.Current.ClassName -eq 'Edit') { $controlHandle } else { [VisualStreamFileDialog]::FindEdit($controlHandle) }
    if ($editHandle -eq [IntPtr]::Zero) { throw 'File name edit was not found.' }
    $null = [VisualStreamFileDialog]::SendMessage($editHandle, 12, [IntPtr]::Zero, $SelectedPath)
  }
}

$buttonId = if ($Cancel) { '2' } else { '1' }
$buttonCondition = [System.Windows.Automation.PropertyCondition]::new($automation::AutomationIdProperty, $buttonId)
$button = $dialog.FindFirst($treeScope::Descendants, $buttonCondition)
if (-not $button) { throw 'File dialog action button was not found.' }
$invokePattern = $null
if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
  $invokePattern.Invoke()
} else {
  $dialogHandle = [IntPtr]$dialog.Current.NativeWindowHandle
  $buttonHandle = [IntPtr]$button.Current.NativeWindowHandle
  if (-not [VisualStreamFileDialog]::PostMessage($dialogHandle, 273, [IntPtr][int]$buttonId, $buttonHandle)) { throw 'File dialog action failed.' }
}

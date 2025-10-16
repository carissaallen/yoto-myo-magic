#!/usr/bin/env python3
"""
Phase 2: Replace remaining hardcoded English strings in content.js with chrome.i18n.getMessage() calls.
"""

import re
import sys

def main():
    file_path = '/Users/callen/Documents/repos/yoto-myo-magic/content/content.js'

    # Read the file
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content
    replacement_count = 0

    # Additional replacements for textContent and other assignments
    replacements = [
        # Button text states
        (r"textContent = 'Authenticating\.\.\.'", "textContent = chrome.i18n.getMessage('button_authenticating')"),
        (r"textContent = 'Loading\.\.\.'", "textContent = chrome.i18n.getMessage('status_loading')"),
        (r"textContent = 'Load More Episodes'", "textContent = chrome.i18n.getMessage('button_loadMore')"),
        (r"textContent = 'Importing\.\.\.'", "textContent = chrome.i18n.getMessage('button_importing')"),
        (r"textContent = 'Cancel Import'", "textContent = chrome.i18n.getMessage('button_cancel')"),
        (r"textContent = 'Completed'", "textContent = chrome.i18n.getMessage('status_completed')"),
        (r"textContent = 'Close'", "textContent = chrome.i18n.getMessage('button_close')"),
        (r"textContent = 'Import Episodes'", "textContent = chrome.i18n.getMessage('button_importPlaylist')"),
        (r"textContent = 'Start Import'", "textContent = chrome.i18n.getMessage('button_startImport')"),

        # Status messages for toothbrush timer
        (r"textContent = 'Preparing toothbrush timer tracks\.\.\.'", "textContent = chrome.i18n.getMessage('status_preparingToothbrushTimer')"),
        (r"textContent = 'Uploading cover art\.\.\.'", "textContent = chrome.i18n.getMessage('status_uploadingCover')"),
        (r"textContent = 'Creating timer card\.\.\.'", "textContent = chrome.i18n.getMessage('status_creatingCard')"),
        (r"textContent = 'Toothbrush timer created successfully! Refreshing\.\.\.'", "textContent = chrome.i18n.getMessage('status_toothbrushTimerSuccess')"),
        (r"textContent = 'Timer created successfully! Refreshing page\.\.\.'", "textContent = chrome.i18n.getMessage('status_timerCreatedSuccess')"),

        # Status messages for bulk import
        (r"textContent = 'Loading ZIP file\.\.\.'", "textContent = chrome.i18n.getMessage('status_loadingZip')"),
        (r"textContent = 'Analyzing folder structure\.\.\.'", "textContent = chrome.i18n.getMessage('status_analyzingFolder')"),
        (r"textContent = 'Extracting playlists\.\.\.'", "textContent = chrome.i18n.getMessage('status_extractingPlaylists')"),
        (r"textContent = 'Fetching existing card content\.\.\.'", "textContent = chrome.i18n.getMessage('status_fetchingCardContent')"),
        (r"textContent = 'Uploading files\.\.\.'", "textContent = chrome.i18n.getMessage('status_uploadingFiles')"),
        (r"textContent = 'Import complete!'", "textContent = chrome.i18n.getMessage('status_importComplete')"),

        # Error messages
        (r"textContent = 'Failed to search podcasts\. Please try again\.'", "textContent = chrome.i18n.getMessage('error_failedSearch')"),
        (r"textContent = 'Update failed: ' \+ error\.message", "textContent = chrome.i18n.getMessage('status_updateFailed') + ': ' + error.message"),

        # Alert messages
        (r"alert\('Please enter a valid duration between 1 and 120 minutes'\)", "alert(chrome.i18n.getMessage('error_invalidDuration'))"),

        # Default values
        (r"\|\| 'Untitled'\)", "|| chrome.i18n.getMessage('label_untitledCard'))"),
        (r"\|\| 'Visual Timer'", "|| chrome.i18n.getMessage('label_visualTimerDefault')"),
    ]

    # Apply replacements
    for pattern, replacement in replacements:
        matches = len(re.findall(pattern, content))
        if matches > 0:
            content = re.sub(pattern, replacement, content)
            replacement_count += matches
            # Try to extract the i18n key for better logging
            key_match = re.search(r"getMessage\('([^']+)'\)", replacement)
            key_name = key_match.group(1) if key_match else "unknown"
            print(f"✓ Replaced {matches}x: {key_name}")

    # Write the file back
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"\n{'='*60}")
    print(f"✓ Total additional replacements made: {replacement_count}")
    print(f"✓ File updated: {file_path}")
    print(f"{'='*60}\n")

    # Check if content changed
    if content == original_content:
        print("⚠ No additional changes were made")
        return 1

    return 0

if __name__ == '__main__':
    sys.exit(main())

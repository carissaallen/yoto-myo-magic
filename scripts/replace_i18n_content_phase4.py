#!/usr/bin/env python3
"""
Phase 4: Final cleanup - Replace remaining user-facing strings in content.js.
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

    # Final user-facing strings
    replacements = [
        # Default playlist name for merged playlists
        (r"\|\| 'Merged Playlist'", "|| chrome.i18n.getMessage('label_mergedPlaylist')"),

        # Source type identifiers (user-facing in notifications)
        (r"'ZIP file'", "chrome.i18n.getMessage('label_zipFile')"),
        (r"'folder'(['\"])", r"chrome.i18n.getMessage('label_folder')\1"),

        # Reason messages
        (r"reason: 'No audio files found'", "reason: chrome.i18n.getMessage('notification_noAudioFiles')"),

        # Progress callback messages
        (r"progressCallback\(100, 'Complete'\)", "progressCallback(100, chrome.i18n.getMessage('status_completed'))"),

        # Modal content with conditionals
        (r"'Ready to add to existing card:'", "chrome.i18n.getMessage('label_readyToAddToCard')"),
        (r"'Ready to update existing card icons:'", "chrome.i18n.getMessage('label_readyToUpdateCardIcons')"),

        # Modal title
        (r"Update Card: \$\{state\.updateCardTitle \|\| 'Untitled'\}", r"${chrome.i18n.getMessage('modal_updateCardTitle', [state.updateCardTitle || chrome.i18n.getMessage('label_untitledCard')])}"),

        # Import completion title
        (r"Import \$\{failedTracks\.length > 0 \? 'Partially' : ''\} Complete!", r"${chrome.i18n.getMessage(failedTracks.length > 0 ? 'modal_importPartiallyComplete' : 'modal_importComplete')}"),

        # Error messages (developer-facing, can keep these)
        # 'No transcoded audio in response' - keep
        # 'No response from server' - keep
        # 'One or more files' - user-facing but specific to error handling
        (r"'One or more files'", "chrome.i18n.getMessage('label_oneOrMoreFiles')"),
    ]

    # Apply replacements
    for pattern, replacement in replacements:
        matches = len(re.findall(pattern, content))
        if matches > 0:
            content = re.sub(pattern, replacement, content)
            replacement_count += matches
            # Try to extract the i18n key for better logging
            key_match = re.search(r"getMessage\('([^']+)'\)", replacement)
            if not key_match:
                key_match = re.search(r"getMessage\(([^?]+)\?", replacement)
            key_name = key_match.group(1) if key_match else pattern[:50]
            print(f"✓ Replaced {matches}x: {key_name}")

    # Write the file back
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"\n{'='*60}")
    print(f"✓ Total phase 4 replacements made: {replacement_count}")
    print(f"✓ File updated: {file_path}")
    print(f"{'='*60}\n")

    if content == original_content:
        print("⚠ No additional changes were made")

    return 0

if __name__ == '__main__':
    sys.exit(main())

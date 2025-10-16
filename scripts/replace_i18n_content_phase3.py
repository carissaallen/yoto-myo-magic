#!/usr/bin/env python3
"""
Phase 3: Replace final hardcoded English strings in content.js with chrome.i18n.getMessage() calls.
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

    # Final batch of replacements - only using keys that exist
    replacements = [
        # Default playlist names
        (r"let folderName = 'Imported Playlist'", "let folderName = chrome.i18n.getMessage('label_importedPlaylist')"),
        (r"defaultName = 'Imported Playlist'", "defaultName = chrome.i18n.getMessage('label_importedPlaylist')"),

        # Progress messages with inline text
        (r"'Uploading icons\.\.\.'", "chrome.i18n.getMessage('status_uploadingIcons')"),
        (r"'Uploading cover image\.\.\.'", "chrome.i18n.getMessage('status_uploadingCoverImage')"),
        (r"'Creating playlist\.\.\.'", "chrome.i18n.getMessage('status_creatingPlaylist')"),

        # Error handling default values
        (r"= 'Unknown error'", "= chrome.i18n.getMessage('label_unknown')"),

        # sourceType uses label_unknown which already exists
        (r"sourceType = 'unknown'", "sourceType = chrome.i18n.getMessage('label_unknown')"),

        # These notification calls were already partially replaced but need to use placeholders correctly
        # They should already be handled from phase 1, but let's double-check
    ]

    # Apply replacements
    for pattern, replacement in replacements:
        matches = len(re.findall(pattern, content))
        if matches > 0:
            content = re.sub(pattern, replacement, content)
            replacement_count += matches
            # Try to extract the i18n key for better logging
            key_match = re.search(r"getMessage\('([^']+)'\)", replacement)
            key_name = key_match.group(1) if key_match else pattern[:50]
            print(f"✓ Replaced {matches}x: {key_name}")

    # Write the file back
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"\n{'='*60}")
    print(f"✓ Total phase 3 replacements made: {replacement_count}")
    print(f"✓ File updated: {file_path}")
    print(f"{'='*60}\n")

    # Check if content changed
    if content == original_content:
        print("⚠ No additional changes were made")
        return 0  # Not an error if nothing changed in phase 3

    return 0

if __name__ == '__main__':
    sys.exit(main())

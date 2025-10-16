#!/usr/bin/env python3
"""
Systematically replace hardcoded English strings in content.js with chrome.i18n.getMessage() calls.
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

    # Define all replacements as tuples of (pattern, replacement)
    # Order matters - more specific patterns should come before general ones
    replacements = [
        # Notifications with checkmarks
        (r"'✓ Authentication successful! Icon matching enabled\.'", "chrome.i18n.getMessage('notification_authSuccessIconMatch')"),
        (r"'✓ Authentication successful! You can now use import features\.'", "chrome.i18n.getMessage('notification_authSuccessImport')"),

        # Authentication notifications
        (r"'Authentication successful! You can now use icon matching\.'", "chrome.i18n.getMessage('notification_authSuccess')"),
        (r"'Authentication failed\. Please try again\.'", "chrome.i18n.getMessage('notification_authFailed')"),
        (r"'Authentication error\. Please try again\.'", "chrome.i18n.getMessage('notification_authError')"),

        # Permission notifications
        (r"'Permission granted! You can now retry importing the podcast\.'", "chrome.i18n.getMessage('notification_permissionGrantedRetry')"),
        (r"'Permission granted! You can now close this modal and try importing again\.'", "chrome.i18n.getMessage('notification_permissionGrantedClose')"),
        (r"'Permission granted! You can now import podcasts\.'", "chrome.i18n.getMessage('notification_permissionGranted')"),
        (r"'Permission denied\. You won\\'t be able to import podcasts\.'", "chrome.i18n.getMessage('notification_permissionDenied')"),

        # Auth required notifications
        (r"'Please authenticate to use update features'", "chrome.i18n.getMessage('notification_authRequiredForUpdate')"),
        (r"'Please authenticate to use import features'", "chrome.i18n.getMessage('notification_authRequiredForImport')"),
        (r"'Please authenticate to use bulk import'", "chrome.i18n.getMessage('notification_authRequiredForBulkImport')"),
        (r"'Please authenticate to use Visual Timer'", "chrome.i18n.getMessage('notification_authRequiredForTimer')"),

        # General error notifications
        (r"'Error occurred\. Please try again\.'", "chrome.i18n.getMessage('notification_errorOccurred')"),
        (r"'Proceeding without auth check\.\.\.'", "chrome.i18n.getMessage('notification_proceedingWithoutAuth')"),

        # ZIP/File processing notifications
        (r"'Error reading ZIP file\. Please try again\.'", "chrome.i18n.getMessage('notification_errorReadingZip')"),
        (r"'Processing ZIP file\.\.\.'", "chrome.i18n.getMessage('status_processingZip')"),
        (r"'Please select a valid ZIP file'", "chrome.i18n.getMessage('notification_invalidZip')"),
        (r"'Processing folder\.\.\.'", "chrome.i18n.getMessage('status_processingFolder')"),
        (r"'Processing bulk folder\.\.\.'", "chrome.i18n.getMessage('status_processingBulkFolder')"),
        (r"'Error processing file\. Please check the file format\.'", "chrome.i18n.getMessage('notification_errorProcessingFile')"),

        # Podcast notifications
        (r"'No episodes found for this podcast'", "chrome.i18n.getMessage('notification_noEpisodesFound')"),
        (r"'Failed to load more episodes'", "chrome.i18n.getMessage('notification_failedToLoadMoreEpisodes')"),
        (r"'Please select at least one episode to import'", "chrome.i18n.getMessage('notification_selectAtLeastOneEpisode')"),
        (r"'Failed to load podcast episodes'", "chrome.i18n.getMessage('notification_failedToLoadPodcastEpisodes')"),
        (r"'Please enter a podcast name'", "chrome.i18n.getMessage('notification_enterPodcastName')"),

        # Audio file notifications (more specific first)
        (r"'No audio files found\. Please ensure your folder contains audio files \(\.mp3, \.m4a, \.m4b, etc\.\)\.'", "chrome.i18n.getMessage('notification_noAudioFiles')"),
        (r"'No audio files found in the ZIP\. Please ensure your ZIP contains audio files \(\.mp3, \.m4a, \.m4b, etc\.\)\.'", "chrome.i18n.getMessage('notification_noAudioFilesZip')"),
        (r"'No audio or icon files found in selection'", "chrome.i18n.getMessage('notification_noAudioOrIconFiles')"),
        (r"'No valid audio files found in the folders\. Please ensure folders contain audio files\.'", "chrome.i18n.getMessage('notification_noAudioFilesInAudioFolder')"),

        # Playlist notifications
        (r"'Please select at least one playlist to import'", "chrome.i18n.getMessage('notification_selectAtLeastOnePlaylist')"),
        (r"'No playlists have valid files after filtering'", "chrome.i18n.getMessage('notification_noValidFilesAfterFilter')"),
        (r"'No files to update after filtering'", "chrome.i18n.getMessage('notification_noFilesToUpdate')"),
        (r"'No valid playlists could be extracted from the nested ZIP files\. Please ensure each ZIP contains audio files\.'", "chrome.i18n.getMessage('notification_noValidPlaylistsZip')"),
        (r"'No valid playlists found\. For bulk import, upload a ZIP containing multiple playlist ZIPs or folders\.'", "chrome.i18n.getMessage('notification_noValidPlaylists')"),
        (r"'No valid playlists found in the selected folder'", "chrome.i18n.getMessage('notification_noValidPlaylistsFolder')"),

        # Merge notifications
        (r"'Successfully merged all content into a single playlist\. Preparing import\.\.\.'", "chrome.i18n.getMessage('notification_mergedToSinglePlaylist')"),
        (r"'Successfully merged all folders into a single playlist\. Preparing import\.\.\.'", "chrome.i18n.getMessage('notification_mergedFoldersToPlaylist')"),
        (r"'Failed to merge playlists'", "chrome.i18n.getMessage('notification_failedToMergePlaylists')"),

        # Root level audio notification
        (r"'Note: Found audio files at root level\. Processing as single playlist\. For bulk import, organize files into folders or separate ZIPs\.'", "chrome.i18n.getMessage('notification_rootLevelAudioFiles')"),

        # Connection notification
        (r"'Extension connection lost\. Please refresh the page and try again\.'", "chrome.i18n.getMessage('notification_connectionLost')"),

        # Success notifications
        (r"'Playlist created successfully!'", "chrome.i18n.getMessage('notification_playlistCreated')"),

        # Buttons
        (r"'Authenticate Now'", "chrome.i18n.getMessage('button_authenticateNow')"),
        (r"'Grant Permission'", "chrome.i18n.getMessage('button_grantPermission')"),
        (r"'Select ZIP File'", "chrome.i18n.getMessage('button_selectZipFile')"),
        (r"'Select Folder'", "chrome.i18n.getMessage('button_selectFolder')"),
        (r"'Continue'", "chrome.i18n.getMessage('button_continue')"),
        (r"'Select All'", "chrome.i18n.getMessage('button_selectAll')"),
        (r"'Deselect All'", "chrome.i18n.getMessage('button_deselectAll')"),
        (r"'Proceed to Bulk Import'", "chrome.i18n.getMessage('button_proceedToBulkImport')"),
        (r"'Start Bulk Import'", "chrome.i18n.getMessage('button_startBulkImport')"),
        (r"'Try Again'", "chrome.i18n.getMessage('button_tryAgain')"),

        # Modal titles and descriptions
        (r"'Permission Required'", "chrome.i18n.getMessage('modal_permissionTitle')"),
        (r"'Select a card to update'", "chrome.i18n.getMessage('modal_selectCardToUpdate')"),
        (r"'Choose which card you want to add audio files to:'", "chrome.i18n.getMessage('modal_chooseCardDescription')"),
        (r"'Select files to add'", "chrome.i18n.getMessage('modal_selectFilesToAdd')"),
        (r"'Select a ZIP file or folder to import'", "chrome.i18n.getMessage('modal_selectZipOrFolder')"),
        (r"'Select timer type'", "chrome.i18n.getMessage('modal_selectTimerType')"),
        (r"'Ready-made timers'", "chrome.i18n.getMessage('modal_readyMadeTimers')"),
        (r"'Collection detected!'", "chrome.i18n.getMessage('modal_collectionDetected')"),
        (r"'Extracting files\.\.\.'", "chrome.i18n.getMessage('modal_extractingFiles')"),
        (r"'Large files detected'", "chrome.i18n.getMessage('modal_largeFilesDetected')"),
        (r"'Import successful!'", "chrome.i18n.getMessage('modal_importSuccessful')"),
        (r"'Import Podcast'", "chrome.i18n.getMessage('modal_importPodcastTitle')"),

        # Input placeholders
        (r"'Search cards\.\.\.'", "chrome.i18n.getMessage('input_searchCards')"),
        (r"'Timer name \(optional\)'", "chrome.i18n.getMessage('input_timerNamePlaceholder')"),
        (r"'Enter duration in minutes'", "chrome.i18n.getMessage('input_customDurationPlaceholder')"),
        (r"'Search podcasts\.\.\.'", "chrome.i18n.getMessage('input_podcastSearchPlaceholder')"),

        # Status messages
        (r"'Loading cards\.\.\.'", "chrome.i18n.getMessage('status_loadingCards')"),
        (r"'Preparing toothbrush timer\.\.\.'", "chrome.i18n.getMessage('status_preparingToothbrushTimer')"),
        (r"'Loading audio files\.\.\.'", "chrome.i18n.getMessage('status_loadingAudioFiles')"),
        (r"'Generating timer icons\.\.\.'", "chrome.i18n.getMessage('status_generatingTimerIcons')"),
        (r"'Uploading audio tracks\.\.\.'", "chrome.i18n.getMessage('status_uploadingAudioTracks')"),
        (r"'Toothbrush timer created successfully!'", "chrome.i18n.getMessage('status_toothbrushTimerSuccess')"),
        (r"'Preparing timer tracks\.\.\.'", "chrome.i18n.getMessage('status_preparingTimerTracks')"),
        (r"'Timer created successfully!'", "chrome.i18n.getMessage('status_timerCreatedSuccess')"),
        (r"'Loading episodes\.\.\.'", "chrome.i18n.getMessage('status_loadingEpisodes')"),
        (r"'Searching podcasts\.\.\.'", "chrome.i18n.getMessage('status_searchingPodcasts')"),
        (r"'Opening ZIP file\.\.\.'", "chrome.i18n.getMessage('status_openingZip')"),
        (r"'Processing folders\.\.\.'", "chrome.i18n.getMessage('status_processingFolders')"),
        (r"'Fetching card content\.\.\.'", "chrome.i18n.getMessage('status_fetchingCardContent')"),
        (r"'Uploading audio files\.\.\.'", "chrome.i18n.getMessage('status_uploadingAudioFiles')"),
        (r"'Uploading icon files\.\.\.'", "chrome.i18n.getMessage('status_uploadingIconFiles')"),
        (r"'Updating card\.\.\.'", "chrome.i18n.getMessage('status_updatingCard')"),
        (r"'Card updated successfully!'", "chrome.i18n.getMessage('status_cardUpdatedSuccess')"),
        (r"'Update failed'", "chrome.i18n.getMessage('status_updateFailed')"),
        (r"'Refreshing page\.\.\.'", "chrome.i18n.getMessage('status_refreshingPage')"),
        (r"'Refreshing\.\.\.'", "chrome.i18n.getMessage('status_refreshing')"),
        (r"'Starting upload\.\.\.'", "chrome.i18n.getMessage('status_startingUpload')"),
        (r"'Finalizing playlist\.\.\.'", "chrome.i18n.getMessage('status_finalizingPlaylist')"),
        (r"'Import cancelled'", "chrome.i18n.getMessage('status_importCancelled')"),
        (r"'Downloading and processing episodes\.\.\.'", "chrome.i18n.getMessage('status_downloadingEpisodes')"),
        (r"'Cancelling import\.\.\.'", "chrome.i18n.getMessage('status_cancellingImport')"),
        (r"'Processing\.\.\.'", "chrome.i18n.getMessage('status_processing')"),

        # Error messages
        (r"'No cards found'", "chrome.i18n.getMessage('error_noCardsFound')"),
        (r"'Error loading cards'", "chrome.i18n.getMessage('error_loadingCards')"),
        (r"'Usage limit reached\. Please try again later\.'", "chrome.i18n.getMessage('error_usageLimitReached')"),
        (r"'Permission required'", "chrome.i18n.getMessage('error_permissionRequired')"),
        (r"'Close this modal and try again'", "chrome.i18n.getMessage('error_closeModalAndRetry')"),
        (r"'Invalid duration\. Please enter a number between 1 and 120\.'", "chrome.i18n.getMessage('error_invalidDuration')"),

        # Labels
        (r"'Untitled Card'", "chrome.i18n.getMessage('label_untitledCard')"),
        (r"'Updated'", "chrome.i18n.getMessage('label_updated')"),
        (r"'Unknown'", "chrome.i18n.getMessage('label_unknown')"),
        (r"'Import mode'", "chrome.i18n.getMessage('label_importMode')"),
        (r"'Separate playlists'", "chrome.i18n.getMessage('label_separatePlaylists')"),
        (r"'Single merged playlist'", "chrome.i18n.getMessage('label_singleMergedPlaylist')"),
        (r"'Custom timer'", "chrome.i18n.getMessage('label_customTimer')"),
        (r"'Timer optimized for Yoto Player'", "chrome.i18n.getMessage('label_timerOptimized')"),
        (r"'Popular kids podcasts'", "chrome.i18n.getMessage('label_popularKidsPodcasts')"),
        (r"'Overall progress'", "chrome.i18n.getMessage('label_overallProgress')"),
        (r"'Existing content will be preserved'", "chrome.i18n.getMessage('label_existingContentPreserved')"),
        (r"'Cover will not be changed'", "chrome.i18n.getMessage('label_coverNotChanged')"),
        (r"'Upload directly'", "chrome.i18n.getMessage('label_uploadDirectly')"),
        (r"'Compress files'", "chrome.i18n.getMessage('label_compressFiles')"),
        (r"'How to fix:'", "chrome.i18n.getMessage('label_howToFix')"),
        (r"'Refresh page'", "chrome.i18n.getMessage('label_refreshPage')"),
        (r"'Ready to import'", "chrome.i18n.getMessage('label_readyToImport')"),
        (r"'Cover Image'", "chrome.i18n.getMessage('label_coverImage')"),
        (r"'Playlist name'", "chrome.i18n.getMessage('label_playlistName')"),

        # Timer-specific strings
        (r"'Hi! Let\\'s brush your teeth together\. Follow along and get ready for a sparkling smile!'", "chrome.i18n.getMessage('timer_toothbrushIntro')"),
        (r"'Top left - front'", "chrome.i18n.getMessage('timer_topLeftFront')"),
        (r"'Top left - back'", "chrome.i18n.getMessage('timer_topLeftBack')"),
        (r"'Top right - front'", "chrome.i18n.getMessage('timer_topRightFront')"),
        (r"'Top right - back'", "chrome.i18n.getMessage('timer_topRightBack')"),
        (r"'Bottom left - front'", "chrome.i18n.getMessage('timer_bottomLeftFront')"),
        (r"'Bottom left - back'", "chrome.i18n.getMessage('timer_bottomLeftBack')"),
        (r"'Bottom right - front'", "chrome.i18n.getMessage('timer_bottomRightFront')"),
        (r"'Bottom right - back'", "chrome.i18n.getMessage('timer_bottomRightBack')"),
        (r"'Great job! You have a sparkling smile!'", "chrome.i18n.getMessage('timer_sparklySmile')"),
        (r"'Toothbrush Timer'", "chrome.i18n.getMessage('timer_toothbrushCardTitle')"),
        (r"'Time\\'s up!'", "chrome.i18n.getMessage('timer_timesUp')"),
        (r"'Complete!'", "chrome.i18n.getMessage('timer_complete')"),
    ]

    # Apply replacements
    for pattern, replacement in replacements:
        matches = len(re.findall(pattern, content))
        if matches > 0:
            content = re.sub(pattern, replacement, content)
            replacement_count += matches
            # Extract key name from replacement for better logging
            key_match = re.search(r"getMessage\('([^']+)'\)", replacement)
            key_name = key_match.group(1) if key_match else "unknown"
            print(f"✓ Replaced {matches}x: {key_name}")

    # Now handle complex patterns with placeholders (template literals)
    complex_replacements = [
        # Template literals with variables
        (r'`Update: \$\{([^}]+)\}`', r'`${chrome.i18n.getMessage("modal_updateCardTitle", [\1])}`'),
        (r'`Uploading files \(\$\{([^}]+)\}/\$\{([^}]+)\}\)\.\.\.`', r'`${chrome.i18n.getMessage("status_uploadingFiles", [\1, \2])}`'),
        (r'`Successfully imported \$\{([^}]+)\} episodes?!`', r'`${chrome.i18n.getMessage("status_successfullyImportedEpisodes", [\1])}`'),
        (r'`Successfully imported \$\{([^}]+)\} playlist\$\{[^}]+\}!`', r'`${chrome.i18n.getMessage("notification_importSuccess", [\1])}`'),
        (r'`Imported \$\{([^}]+)\} playlist\$\{[^}]+\}, \$\{([^}]+)\} failed`', r'`${chrome.i18n.getMessage("notification_importPartialSuccess", [\1, \2])}`'),
        (r'`Failed to import all playlists`', r'chrome.i18n.getMessage("notification_importAllFailed")'),
        (r'`Failed to extract playlists from ZIP files\. \$\{([^}]+)\}\. Please ensure each nested ZIP contains audio files\.`', r'`${chrome.i18n.getMessage("notification_failedToProcessZip", [\1])}`'),
        (r'`Warning: Failed to process \$\{([^}]+)\} ZIP file\(s\): \$\{([^}]+)\}`', r'`${chrome.i18n.getMessage("notification_errorProcessingBulkZip", [\1, \2])}`'),
        (r'`Successfully extracted \$\{([^}]+)\} playlist\$\{([^}]+)\} from \$\{([^}]+)\}\$\{([^}]+)\}\. Preparing import\.\.\.`', r'`${chrome.i18n.getMessage("notification_extractedPlaylists", [\1, \3])}`'),
        (r'`Found \$\{([^}]+)\} playlist\$\{[^}]+\}\. Preparing import\.\.\.`', r'`${chrome.i18n.getMessage("notification_foundPlaylists", [\1])}`'),
        (r'`Folder processed: \$\{([^}]+)\} tracks, \$\{([^}]+)\} icons\$\{([^}]+)\}`', r'`${chrome.i18n.getMessage("notification_folderProcessed", [\1, \2, \3])}`'),
        (r'`ZIP processed: \$\{([^}]+)\} tracks, \$\{([^}]+)\} icons\$\{([^}]+)\}`', r'`chrome.i18n.getMessage("notification_zipProcessed", [\1, \2, \3])`'),
        (r'`Import failed: \$\{([^}]+)\}`', r'`${chrome.i18n.getMessage("notification_importFailedMessage", [\1])}`'),
        (r'`Failed to update card: \$\{([^}]+)\}`', r'`${chrome.i18n.getMessage("notification_updateFailed", [\1])}`'),
        (r'`Failed to process ZIP file\. Error: \$\{([^}]+)\}`', r'`${chrome.i18n.getMessage("notification_failedToProcessZip", [\1])}`'),
        (r'`Error processing bulk ZIP file: \$\{([^}]+)\}`', r'`${chrome.i18n.getMessage("notification_errorProcessingBulkZip", [\1])}`'),
        (r'`Error processing bulk folder: \$\{([^}]+)\}`', r'`${chrome.i18n.getMessage("notification_errorProcessingBulkFolder", [\1])}`'),
        (r'`Error: \$\{([^}]+)\}`', r'`${chrome.i18n.getMessage("error_generic", [\1])}`'),
        (r"`Starting import of \$\{([^}]+)\} episode\$\{[^}]+\}\.\.\.`", r'`${chrome.i18n.getMessage("status_startingImport", [\1])}`'),
    ]

    for pattern, replacement in complex_replacements:
        matches = len(re.findall(pattern, content))
        if matches > 0:
            content = re.sub(pattern, replacement, content)
            replacement_count += matches
            # Extract key name for logging
            key_match = re.search(r'getMessage\("([^"]+)"', replacement)
            key_name = key_match.group(1) if key_match else "template"
            print(f"✓ Replaced {matches}x template: {key_name}")

    # Write the file back
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"\n{'='*60}")
    print(f"✓ Total replacements made: {replacement_count}")
    print(f"✓ File updated: {file_path}")
    print(f"{'='*60}\n")

    # Check if content changed
    if content == original_content:
        print("⚠ Warning: No changes were made to the file")
        return 1

    return 0

if __name__ == '__main__':
    sys.exit(main())

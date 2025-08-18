# Yoto MYO Magic

> _Import playlists from ZIP files or folders to Yoto MYO cards with automatic icon matching._

Transform how you create Yoto cards! Yoto MYO Magic is a Chrome Extension that lets you import entire playlists from ZIP files or folders directly to your Make Your Own (MYO) cards, complete with automatic icon matching for each track.

## ✨ Features

Skip the tedious manual upload process! Import complete playlists with audio files, artwork, and icons in one click, then let the extension automatically match perfect icons to each track.

### 📂 Bulk Import from ZIP or Folder
- **ZIP File Import**: Upload a complete playlist from a single ZIP file
- **Folder Import**: Select a folder containing your audio files
- **Smart File Detection**: Automatically identifies audio files, cover art, and track icons
- **Supported Formats**: MP3, M4A, WAV, OGG, FLAC, AAC, OPUS, WMA
- **Automatic Transcoding**: Files are automatically converted to Yoto-compatible format

### 🐙 Automatic Icon Management
- **Smart Icon Matching**: AI-powered matching based on track titles
- **Bulk Icon Import**: Include custom icons in your ZIP/folder (1.png, 2.png, etc.)
- **Yoto Icon Library**: Access and search Yoto's entire icon collection
- **Confidence Scoring**: See how certain the matches are
- **Manual Override**: Easily change any suggestion

### 📤 Smart Upload Strategies
- **Parallel Upload**: Fast upload for small playlists (< 20 tracks)
- **Chunked Upload**: Reliable upload for large playlists (20+ tracks)
- **Progress Tracking**: Real-time upload progress with percentage complete
- **Error Recovery**: Automatic retry on failed uploads

### 🔒 Secure Authentication
- **OAuth 2.0**: Secure login through Yoto's official authentication
- **No Password Storage**: We never store your Yoto credentials
- **Token Management**: Automatic token refresh for seamless experience

## 🚀 Installation

### From Chrome Web Store
1. Visit the [Chrome Web Store](https://chrome.google.com/webstore) (link coming soon)
2. Click "Add to Chrome"
3. Confirm the installation

## 📖 How to Use

### Import a Playlist

1. **Prepare Your Files**:
   - Create a folder with your audio files
   - Optional: Add `cover.jpg/png` for album art
   - Optional: Add numbered icons (`1.png`, `2.png`, etc.) for custom track icons
   - Optional: Create a ZIP file of the folder

2. **Go to Yoto**:
   - Navigate to [my.yotoplay.com](https://my.yotoplay.com)
   - Go to "My Cards" → "Add a playlist"

3. **Import Your Playlist**:
   - Click the "Import Playlist" button (added by the extension)
   - Choose either ZIP file or folder import
   - Enter a playlist name
   - Click "Start Import"

4. **Watch the Magic**:
   - Files are uploaded automatically
   - Progress bar shows upload status
   - Icons are matched to track titles
   - Playlist is created on your MYO card

### File Structure Example

```
my-playlist/
├── cover.jpg          # Album artwork (optional)
├── 01 - Track One.mp3
├── 02 - Track Two.mp3
├── 03 - Track Three.mp3
├── 1.png             # Icon for track 1 (optional)
├── 2.png             # Icon for track 2 (optional)
└── 3.png             # Icon for track 3 (optional)
```

## 📈 Privacy & Analytics

- **Google Analytics 4**: Used to track feature usage (no personal data)
- **Local Storage Only**: All settings stored locally in your browser
- **No Server Storage**: We don't store any of your content or data

## 🆘 Support

### Getting Help
- **Issues**: [Report bugs or request features](https://github.com/yourusername/yoto-myo-magic/issues)

### Common Issues

**Import button not appearing?**
- Make sure you're on the "Add a playlist" page
- Try refreshing the page
- Check that the extension is enabled

**Upload failing?**
- Check file formats (MP3, M4A, WAV, etc.)
- Ensure files are under 100MB each

**Icons not matching?**
- Make sure track titles are descriptive
- Use the manual search feature

## 📝 License

MIT License - See [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

- Thanks to the Yoto community for inspiration
- Icon matching powered by Yoto's icon library
- Built with love for busy parents and creative kids

---

_Built on a foundation of trial, error, and stubborn grit — this one's for the rule-benders and the card-makers._

**Not affiliated with Yoto. Yoto is a trademark of Yoto Limited.**

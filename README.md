<div align="center">
  <img src="assets/images/myo_popup_transparent.png" alt="Yoto MYO Magic" width="600">
</div>

# Yoto MYO Magic

> _Transform how you create Yoto MYO cards with smart imports, automatic icon matching, and more delightful shortcuts._

Your MYO cards, ready to play as soon as you are. Drop in a ZIP file, point to a folder, or import your favorite podcasts — Yoto MYO Magic turns your raw audio into polished playlists with charming pixel art icons. It's like magic, without the manual fiddling.

## Perfect For

- **Parents** creating custom story collections and educational content
- **Teachers** building curriculum-aligned playlists
- **Podcast Lovers** who want their favorite shows on Yoto
- **Families** preserving audiobooks and music collections
- **Anyone** tired of manual, repetitive playlist creation

## Installation

### From Chrome Web Store
1. Search for [Yoto MYO Magic](https://chromewebstore.google.com/detail/iehnjhgdgfepcjlbfkpngibijmffcmpp?utm_source=item-share-cb) on the Chrome Web Store
2. Click "Add to Chrome"

Buttons will auto-magically appear on the Yoto MYO playlist page!

## What's New

- **📝 Update Playlist**: Add new tracks to existing playlists without starting over
- **🎙️ Import Podcasts**: Bring your favorite kid-friendly shows directly to your Yoto cards
- **🏷️ Smart Icon Matching**: Find perfect icons by theme - animals, nature, music, and more
- **🔋 Device Status**: See your Yoto player's battery level right from the library page

## How to Use

### 📂 Import Playlist from Files

Transform your audio collection into a Yoto playlist in seconds:

1. **Prepare Your Files** (any folder structure works!):
   ```
   my-playlist/
   ├── cover.jpg          # Cover art (optional)
   ├── 01 - Track One.mp3
   ├── 02 - Track Two.mp3
   ├── 03 - Track Three.mp3
   ├── 1.png             # Custom icon for track 1 (optional)
   ├── 2.png             # Custom icon for track 2 (optional)
   └── 3.png             # Custom icon for track 3 (optional)
   ```

2. **Navigate to Yoto**:
   - Go to [Make Your Own](https://my.yotoplay.com/library/make-your-own)
   - Click on your MYO card
   - Click "Add a playlist"

3. **Import Your Content**:
   - Click the **"Import Playlist"** button (added by the extension)
   - Choose ZIP file or folder
   - Name your playlist
   - You audio, icons, and cover art upload automatically!

![Import Playlist Demo](./demo/import-playlist-demo.gif)

### 🎙️ Import Podcasts

Bring your favorite podcasts to Yoto:

1. **Find Your Podcast**:
   - Click **"Import Podcast"** on the playlist page
   - Browse "Best Kids Podcasts" or search by name
   - Select episodes you want

2. **Automatic Import**:
   - Episodes download automatically
   - Metadata and thumbnails included

![Import Podcast Demo](./demo/import-podcast-demo.gif)

### 🎨 Automatic Icon Matching

Let AI find the perfect icons for your tracks:

#### Single Track Icons
- Click the icon button next to any track
- AI suggests matching icons based on the title
- See confidence scores for each match
- Search manually if needed

#### Category-Based Matching
- Select multiple tracks
- Click **"Match by Category"**
- Choose a theme (Animals, Nature, Music, etc.)
- Apply themed icons to all selected tracks at once

![Icon Match Demo](./demo/icon-match-demo.gif)

## Features in Detail

### Supported Formats

- **Audio**: MP3, M4A, WAV, OGG, FLAC, AAC, OPUS, WMA
- **Images**: JPG, PNG (for cover art and custom icons)
- **Archives**: ZIP files for bundled content

### Upload Strategies

The extension intelligently chooses the best upload strategy:
- **Parallel Upload** (< 20 tracks): Fast concurrent uploads
- **Chunked Upload** (20+ tracks): Reliable sequential processing
- **Adaptive Chunking**: Adjusts based on file sizes and network conditions

## 🔒 Privacy & Security

- **OAuth 2.0 Authentication**: Secure login through Yoto's official auth
- **No Password Storage**: We never store your credentials
- **Local Storage Only**: Settings saved in your browser
- **No Server Storage**: Your content never touches our servers
- **Analytics**: Anonymous usage tracking (no personal data)

See [PRIVACY.md](PRIVACY.md) for full details.

## 🐛 Troubleshooting

### Import button not appearing? Stuck on the login request?
- Ensure you're on the "Add a playlist" page
- Refresh the page (the extension loads after the page is ready)
- Check that the extension is enabled in Chrome
- Ensure third-party cookies are enabled for [*.]yotoplay.com 

### Upload failing?
- Verify file formats are supported
- Check individual files are under 100MB
- For podcasts, grant permission when prompted
- Try refreshing and re-authenticating

### Icons not matching well?
- Use simple, clear track titles
- Try the category-based matching for themed content

### Extension lost connection?
- This can happen with long uploads
- The extension automatically recovers
- Your upload will continue in the background

## 👩‍💻 For Developers

### Technical Stack

- **Architecture**: Chrome Extension Manifest V3
- **Content Scripts**: Inject functionality into Yoto pages
- **Service Worker**: Handle API calls and authentication
- **APIs**: Yoto Play API, Yoto Icons, ListenNotes Podcasts
- **Libraries**: JSZip for file handling

### Building from Source

```bash
# Clone the repository
git clone https://github.com/carissaallen/yoto-myo-magic.git

# Install dependencies (if any)
npm install

# Build for production
./build.sh

# The extension is ready to load in Chrome
```

### API Endpoints

The extension integrates with:
- Yoto Play API (`api.yotoplay.com`)
- Yoto Icons (`www.yotoicons.com`)
- ListenNotes API (podcast search and metadata)
- Google Analytics 4 (usage tracking)

## 🆘 Support

- **Bug Reports**: [Submit an issue](https://yotostorylab.com/contact)
- **Feature Requests**: Use the support link above
- **Questions**: Check the troubleshooting section first

## 📝 License

MIT License - See [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

- The amazing Yoto community for inspiration and feedback
- Yoto's delightful pixel art icon library
- ListenNotes for podcast data
- Every parent who has stayed up late making playlists

---

_Built on a foundation of trial, error, and stubborn grit — this one's for the rule-benders and the card-makers._

**Not affiliated with Yoto. Yoto is a trademark of Yoto Limited.**
# Yoto Card Magic Chrome Extension - Implementation Plan

## Project Overview
**Yoto Card Magic** is a Chrome Extension that automatically matches icons to MYO (Make Your Own) playlist tracks on the Yoto website. It solves the tedious task of manually selecting icons for each track by intelligently analyzing track titles and matching them with relevant icons from Yoto's public collection and yotoicons.com.

## Competition Context
- **Competition**: Yoto Developer Challenge 2025
- **Prize Pool**: $10,000 USD total
- **Key Metric**: Weekly engagement (number of distinct families using the app)
- **Deadline**: September 15, 2025, 23:59 BST
- **Category**: Yoto API Integration (live integration with user-specific resources)

## Core Features

### MVP Features
1. **Smart Icon Matching**: Automatically match icons to track names
   - Analyzes track titles (e.g., "Owl" → 🦉, "Baby Wolf Story" → 🐺)
   - Uses Yoto public icons + yotoicons.com database
   - Intelligent matching with synonyms and categories
   - Confidence scoring system

2. **Seamless UI Integration**: Non-intrusive interface on Yoto website
   - Auto-match buttons injected into MYO editing pages
   - Preview overlays showing before/after comparisons
   - Batch processing for entire playlists

3. **Theme-Based Population**: Apply cohesive icon sets
   - Detect card theme from title (e.g., "Dinosaurs by Jen Green")
   - Apply themed icon sets to all tracks
   - Random icon selection within categories

### Advanced Features
4. **Chrome Extension Popup**: Quick access interface
5. **Comprehensive Settings**: Customizable preferences and defaults
6. **Error Handling**: Robust error recovery and user feedback

## Technical Architecture

### Chrome Extension Structure
```
yoto-card-magic-extension/
├── manifest.json              # Chrome extension configuration
├── background/
│   ├── service-worker.js     # Background service worker
│   └── auth.js               # OAuth handling
├── content/
│   ├── content.js            # Content script for Yoto website
│   ├── icon-matcher.js       # Icon matching logic
│   └── ui-injector.js        # UI modifications
├── popup/
│   ├── popup.html            # Extension popup UI
│   ├── popup.js              # Popup logic
│   └── popup.css             # Popup styling
├── options/
│   ├── options.html          # Settings page
│   └── options.js            # Settings management
├── lib/
│   ├── yoto-api.js          # Yoto API client
│   ├── icon-database.js      # Icon caching & search
│   └── utils.js              # Helper functions
└── assets/
    ├── icons/                # Extension icons
    └── styles/               # Shared styles
```

### Tech Stack
- **Platform**: Chrome Extension (Manifest V3)
- **Languages**: JavaScript, HTML, CSS
- **APIs**: Chrome Extension APIs, Yoto API
- **Authentication**: OAuth 2.0 Device Flow
- **Storage**: chrome.storage.local/sync
- **Distribution**: Chrome Web Store

## Implementation Strategy

### Phase 1: Extension Foundation & Authentication
**Goals**: Set up Chrome Extension infrastructure and Yoto API authentication

**Key Components**:
1. **Chrome Extension Manifest (V3)**
   - Configure permissions for Yoto domains
   - Set up content scripts and background service worker
   - Define extension icons and metadata

2. **OAuth Device Flow Implementation**
   - Handle authentication via background service worker
   - Secure token storage in chrome.storage.local
   - Automatic token refresh mechanism

3. **Yoto API Client**
   - Wrapper for all Yoto API endpoints
   - Request authentication and error handling
   - Rate limiting and retry logic

### Phase 2: Icon Database & Matching System
**Goals**: Build intelligent icon matching capabilities

**Key Components**:
1. **Icon Database**
   - Fetch and cache Yoto public icons
   - Import yotoicons.com collection
   - Create searchable index with keywords

2. **Smart Matching Algorithm**
   - Exact title matching (highest priority)
   - Keyword extraction and partial matching
   - Synonym recognition (puppy→dog, kitty→cat)
   - Category-based fallback matching
   - Confidence scoring (0-100)

3. **Theme Detection**
   - Analyze card titles for themes
   - Apply cohesive icon sets
   - Random selection within categories

### Phase 3: Content Script Integration
**Goals**: Seamlessly integrate with Yoto website

**Key Components**:
1. **Page Detection**
   - Monitor for MYO playlist editing pages
   - Extract track titles and current icons
   - Handle dynamic content changes

2. **UI Injection**
   - Add "Auto-Match Icons" buttons
   - Create preview overlays
   - Show confidence indicators
   - Batch processing controls

3. **User Interaction**
   - Preview changes before applying
   - Manual override capabilities
   - Success/error notifications

### Phase 4: Extension Interface
**Goals**: Provide comprehensive user experience

**Key Components**:
1. **Extension Popup**
   - Authentication status
   - Recent activity summary
   - Quick actions and settings

2. **Options Page**
   - Default preferences
   - Theme management
   - Account settings
   - Usage statistics

3. **Error Handling**
   - Graceful error recovery
   - User-friendly messaging
   - Debugging information

## API Integration Points

### Yoto API Endpoints
- `GET /card/mine` - Fetch user's MYO cards
- `GET /icon/public` - Get available public icons
- `POST /card/{id}` - Update card with new icons
- `GET /card/{id}/content` - Get card track details

### Chrome Extension APIs
- `chrome.storage` - Token and preference storage
- `chrome.runtime` - Background service worker messaging
- `chrome.scripting` - Content script injection
- `chrome.identity` - OAuth authentication support

### External Resources
- **yotoicons.com** - Additional icon collection
- **Yoto Developer Docs** - API documentation at yoto.dev

## Icon Matching Algorithm

### Matching Strategy
```javascript
// Priority order for icon matching:
1. Exact match (track: "Owl" → icon: "owl") - Confidence: 100
2. Partial match (track: "Baby Owl" → icon: "owl") - Confidence: 80-95
3. Synonym match (track: "Puppy" → icon: "dog") - Confidence: 70-85
4. Category match (track: "T-Rex" → category: "dinosaurs") - Confidence: 50-70
5. Theme match (card: "Animals" → random animal icon) - Confidence: 40-60
6. Fallback to default/generic icon - Confidence: 0
```

### Synonym Dictionary Examples
```javascript
{
  "puppy": ["dog", "canine"],
  "kitty": ["cat", "feline"],
  "bunny": ["rabbit"],
  "birdie": ["bird"],
  "fishy": ["fish"],
  "doggy": ["dog"],
  "horsey": ["horse"]
}
```

### Theme Categories
- **Animals**: mammals, birds, sea creatures, insects
- **Dinosaurs**: T-Rex, Triceratops, Stegosaurus, etc.
- **Space**: planets, rockets, astronauts, stars
- **Vehicles**: cars, trains, planes, boats
- **Nature**: trees, flowers, weather, landscapes
- **Food**: fruits, vegetables, meals, cooking

## User Experience Flow

### First-Time User Journey
1. **Install Extension** from Chrome Web Store
2. **Visit Yoto Website** and navigate to MYO card editing
3. **See "Connect Yoto Account" button** injected by extension
4. **Complete OAuth Flow** via device code authentication
5. **Click "Auto-Match Icons"** on any MYO playlist
6. **Preview Matched Icons** with confidence scores
7. **Apply Changes** or manually override selections
8. **Success Notification** confirms updates

### Returning User Experience
1. **Automatic Authentication** via stored tokens
2. **One-Click Icon Matching** on any MYO playlist
3. **Theme-Based Matching** for quick cohesive results
4. **Quick Access** via extension popup

## Development Timeline

### Week 1: Foundation & Authentication
**Days 1-3**: Extension Setup & OAuth
- [ ] Chrome Extension manifest and structure
- [ ] Background service worker implementation
- [ ] OAuth device flow authentication
- [ ] Yoto API client wrapper
- [ ] Basic token management

**Days 4-5**: Testing & Refinement
- [ ] End-to-end authentication testing
- [ ] Error handling implementation
- [ ] Token refresh mechanism validation

### Week 2: Core Features & Icon System
**Days 6-8**: Icon Database & Matching
- [ ] Icon database creation and caching
- [ ] Smart matching algorithm implementation
- [ ] Synonym and category systems
- [ ] Confidence scoring mechanism

**Days 9-10**: Content Script Integration
- [ ] Page detection and DOM parsing
- [ ] UI injection system
- [ ] Preview overlay creation

### Week 3: User Interface & Polish
**Days 11-13**: Extension Interface
- [ ] Popup interface development
- [ ] Options page creation
- [ ] Theme-based population features
- [ ] Error handling and user feedback

**Days 14-15**: Testing & Optimization
- [ ] Cross-browser compatibility testing
- [ ] Performance optimization
- [ ] User acceptance testing

### Week 4: Deployment & Submission
**Days 16-17**: Chrome Web Store Preparation
- [ ] Extension packaging and validation
- [ ] Store listing materials creation
- [ ] Privacy policy and documentation

**Days 18-20**: Competition Submission
- [ ] Final testing and bug fixes
- [ ] Demo video creation
- [ ] Competition form submission
- [ ] Community engagement launch

## Success Metrics & Analytics

### Competition Metrics
- **Weekly Engagement**: Number of distinct families actively using the extension each week
- **Usage Duration**: Time spent using the extension per session
- **Feature Adoption**: Percentage of users utilizing different features

### Development KPIs
- **Icon Match Accuracy**: Percentage of automatic matches users keep vs. override
- **Time Savings**: Average time saved vs. manual icon selection
- **User Retention**: Percentage of users returning weekly
- **Error Rate**: Frequency of API failures or extension errors

### Tracking Implementation
```javascript
// Privacy-friendly analytics
{
  weeklyActiveUsers: number,     // Anonymized family count
  iconsMatchedPerSession: number,
  matchAccuracyRate: percentage,
  featureUsageStats: object,
  errorFrequency: number
}
```

## Security & Privacy Considerations

### Data Security
- **Token Storage**: Secure storage using chrome.storage.local
- **API Communications**: HTTPS-only with proper authentication
- **No Personal Data**: Avoid storing unnecessary user information
- **Minimal Permissions**: Request only required Chrome permissions

### Privacy Policy
- **Data Collection**: Limited to usage analytics for competition metrics
- **Third-Party Integration**: Only with Yoto's official APIs
- **User Control**: Clear opt-out mechanisms for data collection
- **Transparency**: Open-source approach for code transparency

## Risk Mitigation

### Technical Risks
1. **Chrome Extension Policy Changes**
   - Mitigation: Follow best practices, stay updated with Chrome guidelines

2. **Yoto Website Changes**
   - Mitigation: Use resilient CSS selectors, implement fallback mechanisms

3. **API Rate Limiting**
   - Mitigation: Aggressive caching, request optimization, user feedback

4. **Icon Matching Accuracy**
   - Mitigation: Allow manual override, collect user feedback for improvements

### Competition Risks
1. **Submission Deadline Pressure**
   - Mitigation: Focus on MVP features first, defer advanced features

2. **Chrome Web Store Review Delays**
   - Mitigation: Submit early, have backup distribution plan

3. **User Adoption Challenges**
   - Mitigation: Clear onboarding, comprehensive documentation, community engagement

## Post-MVP Enhancements

### Future Features (Post-Competition)
1. **AI Icon Generation**: Create custom icons when none exist
2. **Collaborative Icon Sharing**: Community-driven icon packs
3. **Advanced Analytics**: Detailed usage insights and optimization
4. **Multi-Language Support**: Support for non-English track titles
5. **Bulk Operations**: Process multiple cards simultaneously
6. **Icon History**: Undo/redo functionality for changes
7. **Integration Expansions**: Support for additional music platforms

### Monetization Opportunities
- **Premium Themes**: Advanced icon packs and themes
- **Custom Icon Generation**: AI-powered icon creation service
- **Enterprise Features**: Bulk processing for content creators
- **API Access**: Allow third-party integrations

## Resources & Documentation

### Official Documentation
- [Yoto API Documentation](https://yoto.dev)
- [Yoto Developer Dashboard](https://developers.yotoplay.com)
- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [OAuth 2.0 Device Flow Specification](https://www.rfc-editor.org/rfc/rfc8628)

### Community Resources
- [yotoicons.com](https://www.yotoicons.com) - Icon collection
- [Yoto Space Developers Hub](https://space.yotoplay.com) - Developer community
- Chrome Web Store Developer Console

### Development Tools
- Chrome Extension Developer Tools
- Chrome DevTools for debugging
- Postman for API testing
- Git/GitHub for version control

## Conclusion

The Yoto Card Magic Chrome Extension represents a comprehensive solution for automating MYO playlist icon management. By focusing on intelligent matching algorithms, seamless user experience, and robust error handling, this extension will provide genuine value to Yoto families while competing effectively in the Developer Challenge 2025.

The modular architecture ensures scalability for future enhancements, while the Chrome Extension platform provides wide accessibility and easy distribution. Success will be measured by weekly engagement metrics, demonstrating the extension's value in regular family routines.

---

*Created for Yoto Developer Challenge 2025*  
*Target Submission: September 15, 2025, 23:59 BST*  
*Last Updated: August 12, 2025*
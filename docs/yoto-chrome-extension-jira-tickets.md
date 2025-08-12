# Yoto Card Magic Chrome Extension - Jira Tickets

## Epic: Yoto Card Magic Chrome Extension
**Description**: Build a Chrome Extension that automatically matches icons to MYO playlist tracks for the Yoto Developer Challenge 2025.

---

## Sprint 1: Foundation & Extension Setup

### YOTO-EXT-001: Chrome Extension Project Setup and Manifest
**Type**: Task  
**Priority**: High  
**Story Points**: 3

**Description**:
Create the basic Chrome Extension structure with proper manifest.json configuration to support Yoto website integration.

**Acceptance Criteria**:
- [ ] Manifest v3 configuration created with proper permissions
- [ ] Extension loads successfully in Chrome developer mode
- [ ] Permissions for Yoto domains configured (yotoplay.com, api.yotoplay.com, etc.)
- [ ] Project directory structure follows Chrome Extension best practices
- [ ] Basic extension icons created (16x16, 32x32, 48x48, 128x128)
- [ ] Content scripts configured for Yoto website pages
- [ ] Web accessible resources properly declared

**Technical Notes**:
- Use Manifest V3 (latest standard)
- Required permissions: storage, activeTab, identity, scripting
- Host permissions for Yoto domains and yotoicons.com
- Content Security Policy configured

**Definition of Done**:
- Extension can be loaded in Chrome://extensions
- No manifest errors in developer console
- Extension appears in Chrome toolbar

---

### YOTO-EXT-002: Background Service Worker Implementation
**Type**: Story  
**Priority**: Critical  
**Story Points**: 5

**Description**:
As a developer, I need a background service worker to handle OAuth authentication, API calls, and cross-tab communication for the extension.

**Acceptance Criteria**:
- [ ] Service worker properly registered and running
- [ ] OAuth 2.0 device flow implementation for Yoto authentication
- [ ] Secure token storage using chrome.storage.local
- [ ] Token refresh mechanism when tokens expire
- [ ] Message passing between content scripts and background
- [ ] API rate limiting and retry logic
- [ ] Error handling for authentication failures

**Technical Notes**:
- OAuth endpoints: https://login.yotoplay.com/oauth/device/code, /oauth/token
- Store access/refresh tokens securely
- Implement automatic token refresh 5 minutes before expiry
- Use chrome.runtime.onMessage for communication

**Test Cases**:
1. Successful OAuth device flow completion
2. Token refresh when expired
3. Service worker restart persistence
4. Message passing functionality

---

### YOTO-EXT-003: Yoto API Client Library
**Type**: Story  
**Priority**: High  
**Story Points**: 4

**Description**:
As a developer, I need a robust API client to interact with Yoto's endpoints for retrieving user data and updating cards.

**Acceptance Criteria**:
- [ ] API client class with authentication headers
- [ ] getUserMYOCards() - Fetch user's MYO content
- [ ] getPublicIcons() - Retrieve available icons
- [ ] updateCardContent() - Update card with new icons
- [ ] getCardDetails() - Get specific card information
- [ ] Proper error handling for API failures
- [ ] Request/response logging for debugging
- [ ] Retry mechanism for transient failures

**Technical Notes**:
- Base URL: https://api.yotoplay.com
- All requests require Bearer token authentication
- Implement exponential backoff for retries
- Handle 401 responses by triggering token refresh

**API Endpoints**:
- GET /card/mine - User's MYO cards
- GET /icon/public - Public icons
- POST /card/{id} - Update card
- GET /card/{id}/content - Card tracks

---

## Sprint 2: Icon System & Core Logic

### YOTO-EXT-004: Icon Database and Caching System
**Type**: Story  
**Priority**: High  
**Story Points**: 4

**Description**:
As a system, I need to build and maintain a searchable database of icons from Yoto's public collection and yotoicons.com for efficient matching.

**Acceptance Criteria**:
- [ ] Fetch and cache Yoto public icons on extension install
- [ ] Import yotoicons.com icon collection (via scraping or API)
- [ ] Create searchable index with keywords for each icon
- [ ] Implement icon categories and tags
- [ ] Local storage using chrome.storage.local with size limits
- [ ] Background sync to update icon database daily
- [ ] Icon metadata includes: ID, name, URL, keywords, category
- [ ] Search functionality by keyword, category, or exact match

**Technical Notes**:
- Use chrome.storage.local (max 10MB, consider chunking large datasets)
- Index creation for fast text search
- Handle icon URL validation and accessibility
- Consider compression for large datasets

**Data Structure**:
```javascript
{
  iconId: string,
  name: string,
  url: string,
  keywords: string[],
  category: string,
  source: 'yoto' | 'yotoicons'
}
```

---

### YOTO-EXT-005: Smart Icon Matching Algorithm
**Type**: Story  
**Priority**: Critical  
**Story Points**: 5

**Description**:
As a user, I want the system to intelligently match icons to track titles so that I can quickly populate my MYO cards with relevant visuals.

**Acceptance Criteria**:
- [ ] Exact title matching (highest confidence score)
- [ ] Partial word matching with scoring
- [ ] Keyword extraction from track titles
- [ ] Synonym recognition (puppy→dog, kitty→cat, etc.)
- [ ] Category-based fallback matching
- [ ] Confidence scoring system (0-100)
- [ ] Return top 3 suggestions per track
- [ ] Handle special characters and case insensitivity
- [ ] Default icon selection when no matches found
- [ ] Performance optimization for batch processing

**Technical Notes**:
- Implement fuzzy string matching algorithm
- Create synonym dictionary for common words
- Use weighted scoring: exact match (100), partial (70-90), category (40-60)
- Consider Levenshtein distance for typo tolerance

**Test Cases**:
1. Exact match: "Owl" → owl icon (confidence: 100)
2. Partial match: "Baby Owl Story" → owl icon (confidence: 85)
3. Synonym: "Puppy Adventure" → dog icon (confidence: 80)
4. Category: "T-Rex Roar" → dinosaur category icon (confidence: 60)
5. No match: "Xyz123Random" → default icon (confidence: 0)

---

### YOTO-EXT-006: Content Script for Page Detection
**Type**: Story  
**Priority**: High  
**Story Points**: 3

**Description**:
As a user, I want the extension to detect when I'm on MYO playlist editing pages so that it can offer icon matching functionality.

**Acceptance Criteria**:
- [ ] Detect MYO card editing pages via URL patterns
- [ ] Identify track list containers in the DOM
- [ ] Extract track titles and current icon assignments
- [ ] Monitor for dynamic content changes (SPA navigation)
- [ ] Handle different Yoto page layouts and designs
- [ ] Debounce detection to avoid excessive processing
- [ ] Send page context to background service worker
- [ ] Error handling for DOM parsing failures

**Technical Notes**:
- Watch for URLs matching: /myo/, /edit/, /playlist/ patterns
- Use MutationObserver for dynamic content
- Implement CSS selectors that are resilient to layout changes
- Consider iframe detection if needed

**Page Patterns**:
- https://yotoplay.com/myo/edit/*
- https://my.yotoplay.com/cards/*/edit
- https://yotoplay.com/playlist/*/edit

---

## Sprint 3: User Interface & Interaction

### YOTO-EXT-007: UI Injection and Auto-Match Interface
**Type**: Story  
**Priority**: Critical  
**Story Points**: 5

**Description**:
As a user, I want a seamless interface injected into the Yoto website that allows me to auto-match icons and preview changes before applying them.

**Acceptance Criteria**:
- [ ] Inject "Auto-Match Icons" button near track listings
- [ ] Create icon preview overlay showing before/after comparison
- [ ] Display confidence scores for each match
- [ ] Allow manual icon selection override
- [ ] Batch selection controls (select all, apply changes)
- [ ] Loading states during matching process
- [ ] Success/error notifications
- [ ] Non-intrusive design that matches Yoto's UI
- [ ] Mobile-responsive design for tablet users
- [ ] Keyboard navigation support

**Technical Notes**:
- Use CSS-in-JS or inline styles to avoid conflicts
- Shadow DOM for style isolation (if needed)
- Event delegation for dynamic content
- Implement proper z-index management

**UI Components**:
- Auto-match button
- Preview modal/overlay
- Progress indicators
- Match confidence badges
- Icon selection grid
- Apply/cancel buttons

---

### YOTO-EXT-008: Extension Popup Interface
**Type**: Story  
**Priority**: Medium  
**Story Points**: 3

**Description**:
As a user, I want a quick-access popup from the extension icon that shows my recent cards, matching statistics, and settings shortcuts.

**Acceptance Criteria**:
- [ ] Display authentication status
- [ ] List of recently accessed MYO cards
- [ ] Quick stats (icons matched today, cards updated)
- [ ] "Open Current Card" button if on Yoto page
- [ ] Link to full options page
- [ ] Manual icon search functionality
- [ ] Logout button
- [ ] Responsive design for different popup sizes

**Technical Notes**:
- Popup dimensions: 400px width, max 600px height
- Use chrome.tabs API to detect current Yoto pages
- Implement local analytics storage for statistics
- Handle popup closing/reopening state

**Popup Sections**:
1. Header with extension name and status
2. Current card context (if applicable)
3. Recent activity summary
4. Quick actions
5. Settings link

---

### YOTO-EXT-009: Options and Settings Page
**Type**: Story  
**Priority**: Medium  
**Story Points**: 3

**Description**:
As a user, I want a comprehensive settings page where I can configure default preferences, view matching history, and manage my Yoto account connection.

**Acceptance Criteria**:
- [ ] Authentication management (login/logout)
- [ ] Default icon preferences configuration
- [ ] Matching algorithm sensitivity settings
- [ ] Theme pack selection and management
- [ ] Icon database update controls
- [ ] Usage statistics and history
- [ ] Export/import settings functionality
- [ ] Clear cache and reset options
- [ ] Help documentation and FAQ

**Technical Notes**:
- Full-page options interface
- Use chrome.storage.sync for settings persistence
- Implement settings validation and defaults
- Provide clear reset-to-defaults option

**Settings Categories**:
1. Account & Authentication
2. Matching Preferences  
3. Default Icons & Themes
4. Advanced Options
5. Data & Privacy

---

## Sprint 4: Advanced Features & Polish

### YOTO-EXT-010: Theme-Based Icon Population
**Type**: Story  
**Priority**: Medium  
**Story Points**: 4

**Description**:
As a user, I want to apply cohesive icon themes to my MYO cards based on the card title or selected category (e.g., all dinosaur icons for a "Dinosaurs" card).

**Acceptance Criteria**:
- [ ] Detect card theme from title analysis
- [ ] Predefined theme packs (animals, dinosaurs, space, vehicles, etc.)
- [ ] Theme suggestion based on card content
- [ ] Apply themed icons across all tracks in a card
- [ ] Random icon selection within theme constraints
- [ ] Custom theme creation and saving
- [ ] Theme preview before application
- [ ] Mix-and-match theme combinations

**Technical Notes**:
- Theme detection using keyword analysis of card titles
- Create theme definitions with icon sets
- Implement theme scoring and suggestion logic
- Store custom themes in user preferences

**Built-in Themes**:
- Animals (mammals, birds, sea creatures)
- Dinosaurs & Prehistoric
- Space & Astronomy
- Vehicles & Transportation
- Nature & Weather
- Food & Cooking
- Sports & Activities

---

### YOTO-EXT-011: Error Handling and User Feedback
**Type**: Story  
**Priority**: High  
**Story Points**: 3

**Description**:
As a user, I want clear feedback when things go wrong and helpful guidance on how to resolve issues with the extension.

**Acceptance Criteria**:
- [ ] Comprehensive error handling for all API calls
- [ ] User-friendly error messages (no technical jargon)
- [ ] Retry mechanisms for transient failures
- [ ] Offline mode detection and handling
- [ ] Rate limiting graceful degradation
- [ ] Authentication error recovery flows
- [ ] Network connectivity status indicators
- [ ] Debugging information for support requests
- [ ] Progressive enhancement when features fail

**Technical Notes**:
- Implement error categorization (network, auth, validation, etc.)
- Use toast notifications for non-blocking feedback
- Provide actionable next steps in error messages
- Log errors for debugging while respecting privacy

**Error Categories**:
1. Authentication errors
2. Network/API failures
3. Parsing/data errors
4. Permission issues
5. Rate limiting
6. Browser compatibility

---

### YOTO-EXT-012: Performance Optimization and Testing
**Type**: Task  
**Priority**: High  
**Story Points**: 4

**Description**:
Optimize extension performance, conduct comprehensive testing, and prepare for Chrome Web Store submission.

**Acceptance Criteria**:
- [ ] Performance profiling and optimization
- [ ] Memory usage optimization
- [ ] Bundle size minimization
- [ ] Load time optimization
- [ ] Cross-browser testing (Chrome, Edge, Brave)
- [ ] Automated testing suite setup
- [ ] Security audit and vulnerability assessment
- [ ] Chrome Web Store compliance review
- [ ] Privacy policy and permissions justification
- [ ] User acceptance testing with real Yoto accounts

**Technical Notes**:
- Use Chrome DevTools for performance profiling
- Implement lazy loading for non-critical features
- Minimize DOM manipulation frequency
- Use efficient event handling patterns

**Testing Checklist**:
1. Fresh install experience
2. Authentication flow testing
3. Icon matching accuracy
4. UI responsiveness
5. Error scenario handling
6. Performance under load
7. Multi-tab behavior
8. Extension update scenarios

---

## Sprint 5: Deployment & Competition Submission

### YOTO-EXT-013: Chrome Web Store Preparation
**Type**: Task  
**Priority**: Critical  
**Story Points**: 3

**Description**:
Prepare all materials and documentation required for Chrome Web Store submission and competition entry.

**Acceptance Criteria**:
- [ ] Extension package creation and validation
- [ ] Chrome Web Store listing materials prepared
- [ ] Screenshots and promotional images created
- [ ] Privacy policy documentation
- [ ] Terms of service document
- [ ] User guide and help documentation
- [ ] Video demo recording
- [ ] Competition submission form completion
- [ ] Beta testing with target users

**Technical Notes**:
- Package extension as .crx file for distribution
- Ensure all Chrome Web Store policies compliance
- Create high-quality screenshots (1280x800 or 640x400)
- Write compelling store description

**Deliverables**:
1. Extension .crx package
2. Store listing description
3. Screenshots (5 maximum)
4. Promotional tile image
5. Privacy policy
6. Demo video (optional but recommended)

---

### YOTO-EXT-014: Competition Submission and Marketing
**Type**: Task  
**Priority**: Critical  
**Story Points**: 2

**Description**:
Submit the extension to the Yoto Developer Challenge 2025 and prepare marketing materials to drive weekly engagement.

**Acceptance Criteria**:
- [ ] Competition submission form completed
- [ ] Extension published to Chrome Web Store
- [ ] Demo video uploaded and shared
- [ ] Documentation website created
- [ ] Social media assets prepared
- [ ] Community engagement plan executed
- [ ] Usage analytics tracking implemented
- [ ] Feedback collection mechanism setup

**Technical Notes**:
- Implement analytics to track "weekly engagement" metric
- Use Google Analytics or custom tracking
- Ensure compliance with privacy regulations
- Track distinct families (not individual users)

**Marketing Assets**:
1. Product landing page
2. Tutorial videos
3. Social media graphics
4. Community forum posts
5. Press release draft
6. User testimonials

---

## Backlog (Future Enhancements)

### YOTO-EXT-015: AI Icon Generation Integration
**Type**: Epic  
**Priority**: Low  
**Story Points**: 8

**Description**:
Integrate AI icon generation for cases where no suitable icons exist in the database.

---

### YOTO-EXT-016: Collaborative Icon Sharing
**Type**: Story  
**Priority**: Low  
**Story Points**: 5

**Description**:
Allow users to share custom icon sets and theme packs with the community.

---

### YOTO-EXT-017: Advanced Analytics Dashboard
**Type**: Story  
**Priority**: Low  
**Story Points**: 4

**Description**:
Provide detailed analytics about icon usage patterns and matching effectiveness.

---

## Definition of Done
- [ ] Code reviewed and approved
- [ ] Unit tests written and passing
- [ ] Integration testing completed
- [ ] Documentation updated
- [ ] Chrome Web Store compliance verified
- [ ] No critical security vulnerabilities
- [ ] Performance benchmarks met
- [ ] User acceptance criteria satisfied

## Sprint Schedule
- **Sprint 1**: Days 1-4 (Foundation & Extension Setup)
- **Sprint 2**: Days 5-8 (Icon System & Core Logic)
- **Sprint 3**: Days 9-12 (User Interface & Interaction)
- **Sprint 4**: Days 13-16 (Advanced Features & Polish)
- **Sprint 5**: Days 17-20 (Deployment & Competition Submission)

## Risk Register
1. **Risk**: Chrome extension policy changes
   - **Mitigation**: Stay updated with Chrome extension guidelines

2. **Risk**: Yoto website layout changes breaking selectors
   - **Mitigation**: Use resilient CSS selectors, implement fallbacks

3. **Risk**: API rate limiting affecting user experience
   - **Mitigation**: Implement aggressive caching and request optimization

4. **Risk**: Competition deadline pressure
   - **Mitigation**: Focus on MVP features first, defer nice-to-haves

5. **Risk**: Chrome Web Store review delays
   - **Mitigation**: Submit early, have backup distribution plan

---

*Created for Yoto Developer Challenge 2025*
*Target Submission: September 15, 2025*
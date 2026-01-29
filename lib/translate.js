/**
 * Translation utilities using Google Cloud Translation API via proxy service
 */

const TranslationService = {
    // Cache for translations to avoid redundant API calls
    cache: new Map(),

    // Get proxy URL from config (falls back to default if config not loaded)
    get proxyUrl() {
        return (typeof ExtensionConfig !== 'undefined' && ExtensionConfig.PROXY_SERVER_URL)
            ? ExtensionConfig.PROXY_SERVER_URL
            : 'https://api.yotomyomagic.com';
    },

    /**
     * Detects the language of the given text
     * @param {string} text - The text to detect language for
     * @returns {Promise<string>} - The detected language code (e.g., 'en', 'es', 'fr')
     */
    async detectLanguage(text) {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return 'en'; // Default to English for empty strings
        }

        try {
            const cacheKey = `detect:${text}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            const response = await fetch(`${this.proxyUrl}/api/translate/detect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text
                })
            });

            if (!response.ok) {
                console.warn('Language detection failed:', response.status);
                return 'en'; // Default to English on error
            }

            const data = await response.json();

            if (data.language) {
                this.cache.set(cacheKey, data.language);
                return data.language;
            }

            return 'en'; // Default to English if detection fails
        } catch (error) {
            console.warn('Error detecting language:', error);
            return 'en'; // Default to English on error
        }
    },

    /**
     * Translates text to English if it's not already in English
     * @param {string} text - The text to translate
     * @returns {Promise<string>} - The translated text (or original if already English)
     */
    async translateToEnglish(text) {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return text;
        }

        try {
            // Check if we've already translated this text
            const cacheKey = `translate:${text}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            // Detect the language first
            const detectedLanguage = await this.detectLanguage(text);

            // If already English, return as-is
            if (detectedLanguage === 'en') {
                this.cache.set(cacheKey, text);
                return text;
            }

            const response = await fetch(`${this.proxyUrl}/api/translate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text,
                    target: 'en',
                    source: detectedLanguage
                })
            });

            if (!response.ok) {
                console.warn('Translation failed:', response.status);
                return text; // Return original text on error
            }

            const data = await response.json();

            if (data.translatedText) {
                this.cache.set(cacheKey, data.translatedText);
                return data.translatedText;
            }

            return text; // Return original text if translation fails
        } catch (error) {
            console.warn('Error translating text:', error);
            return text; // Return original text on error
        }
    },

    /**
     * Clears the translation cache
     */
    clearCache() {
        this.cache.clear();
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.TranslationService = TranslationService;
}

// For use in service workers
if (typeof self !== 'undefined' && !self.window) {
    self.TranslationService = TranslationService;
}

// Utility functions

const Utils = {
  // Debounce function to limit function calls
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Throttle function to limit function execution rate
  throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  // Extract keywords from text
  extractKeywords(text) {
    if (!text) return [];
    
    // Convert to lowercase and split by common delimiters
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
    
    // Remove common stop words
    const stopWords = ['the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'were'];
    return words.filter(word => !stopWords.includes(word));
  },

  // Calculate string similarity (Levenshtein distance)
  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    if (s1 === s2) return 100;
    
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 100;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return Math.round(((longer.length - editDistance) / longer.length) * 100);
  },

  // Levenshtein distance algorithm
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  },

  // Format date for display
  formatDate(date) {
    const options = { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    };
    return new Date(date).toLocaleDateString('en-US', options);
  },

  // Generate unique ID
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  },

  // Validate URL
  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  },

  // Check if running in extension context
  isExtensionContext() {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  },

  // Safe storage get with default value
  async getStorageData(key, defaultValue = null) {
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] || defaultValue;
    } catch (error) {
      
      return defaultValue;
    }
  },

  // Safe storage set
  async setStorageData(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
      return true;
    } catch (error) {
      
      return false;
    }
  },

  // Chunk array for batch processing
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  },

  // Wait for element to appear
  waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  },

  // Sanitize HTML to prevent XSS
  sanitizeHtml(html) {
    const temp = document.createElement('div');
    temp.textContent = html;
    return temp.innerHTML;
  },

  // Deep clone object
  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => this.deepClone(item));
    
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = this.deepClone(obj[key]);
      }
    }
    return clonedObj;
  },

  // Check if a word is likely plural (not definitive, best guess)
  isPlural(word) {
    if (!word || word.length < 3) return false;
    
    const lower = word.toLowerCase();
    
    // Words that are same in singular/plural
    const unchangedWords = ['sheep', 'fish', 'deer', 'moose', 'series', 'species', 'news'];
    if (unchangedWords.includes(lower)) return false;
    
    // Words ending in 'ss' are likely singular (glass, class, pass)
    if (lower.endsWith('ss')) return false;
    
    // Check common plural patterns
    return (
      lower.endsWith('s') ||
      lower.endsWith('ies') ||
      lower.endsWith('ves') ||
      ['children', 'people', 'mice', 'geese', 'feet', 'teeth', 'men', 'women'].includes(lower)
    );
  },

  // Convert plural to singular (best effort, not guaranteed accurate)
  singularize(word) {
    if (!word || !this.isPlural(word)) {
      return word;
    }
    
    const lower = word.toLowerCase();
    const wasCapitalized = word[0] === word[0].toUpperCase();
    
    // Handle irregular plurals
    const irregular = {
      'children': 'child',
      'people': 'person', 
      'mice': 'mouse',
      'geese': 'goose',
      'feet': 'foot',
      'teeth': 'tooth',
      'men': 'man',
      'women': 'woman',
      'oxen': 'ox'
    };
    
    if (irregular[lower]) {
      const singular = irregular[lower];
      return wasCapitalized 
        ? singular.charAt(0).toUpperCase() + singular.slice(1)
        : singular;
    }
    
    let result = word;
    
    // puppies → puppy
    if (lower.endsWith('ies') && lower.length > 4) {
      result = word.slice(0, -3) + 'y';
    }
    // wolves → wolf, knives → knife  
    else if (lower.endsWith('ves')) {
      // wolves → wolf
      if (lower.endsWith('lves')) {
        result = word.slice(0, -3) + 'f';
      }
      // knives → knife
      else {
        result = word.slice(0, -3) + 'fe';
      }
    }
    // boxes → box, churches → church, buses → bus
    else if (lower.endsWith('xes') || lower.endsWith('ches') || 
             lower.endsWith('shes') || lower.endsWith('ses')) {
      result = word.slice(0, -2);
    }
    // cats → cat
    else if (lower.endsWith('s')) {
      result = word.slice(0, -1);
    }
    
    return result;
  }
};

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
}
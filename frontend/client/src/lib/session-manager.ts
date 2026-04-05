// Session Manager - Handles unique browser identification and session storage
// Each browser/tab gets a unique ID so they're treated as separate users

function generateBrowserFingerprint(): string {
  // Create a unique ID for this browser tab instance
  return 'browser_' + Math.random().toString(36).substring(2) + '_' + Date.now();
}

function getOrCreateFingerprint(): string {
  // Use sessionStorage so each tab gets its own identity
  let fingerprint = sessionStorage.getItem('browserFingerprint');
  if (!fingerprint) {
    fingerprint = generateBrowserFingerprint();
    sessionStorage.setItem('browserFingerprint', fingerprint);
  }
  return fingerprint;
}

export const sessionManager = {
  // Get unique browser fingerprint
  getFingerprint(): string {
    return getOrCreateFingerprint();
  },

  // Player name - stored per browser session
  getPlayerName(): string | null {
    return sessionStorage.getItem('playerName');
  },

  setPlayerName(name: string): void {
    sessionStorage.setItem('playerName', name);
  },

  // Player avatar - stored per browser session
  getPlayerAvatar(): string | null {
    return sessionStorage.getItem('playerAvatar');
  },

  setPlayerAvatar(avatar: string): void {
    sessionStorage.setItem('playerAvatar', avatar);
  },

  // Check if this session has a profile
  hasProfile(): boolean {
    return !!sessionStorage.getItem('playerName');
  },

  // Clear profile for this session only
  clearProfile(): void {
    sessionStorage.removeItem('playerName');
    sessionStorage.removeItem('playerAvatar');
  },

  // Generate a random avatar seed
  generateAvatarSeed(): string {
    return Math.random().toString(36).substring(7);
  }
};

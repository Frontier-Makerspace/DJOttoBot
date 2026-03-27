const fs = require('fs');
const path = require('path');
const os = require('os');

// Levenshtein distance for fuzzy matching
function levenshtein(a, b) {
  const an = a.length, bn = b.length;
  const d = Array(an + 1).fill(null).map(() => Array(bn + 1).fill(0));
  for (let i = 0; i <= an; i++) d[i][0] = i;
  for (let j = 0; j <= bn; j++) d[0][j] = j;
  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[an][bn];
}

function similarityScore(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshtein(a.toLowerCase(), b.toLowerCase());
  return 1.0 - distance / maxLen;
}

/**
 * Score how well a query matches a candidate string.
 * Uses multiple strategies: exact contains, word-boundary match, Levenshtein.
 * Returns 0.0–1.0
 */
function matchScore(query, candidate) {
  const q = query.toLowerCase().trim();
  const c = candidate.toLowerCase().trim();

  if (!q || !c) return 0;

  // Exact match
  if (q === c) return 1.0;

  // Exact substring (query appears in candidate or vice versa)
  if (c.includes(q)) return 0.95;
  if (q.includes(c)) return 0.9;

  // Levenshtein on the full strings
  const fullSim = similarityScore(q, c);

  // Also try Levenshtein on individual words of the candidate
  const candidateWords = c.split(/[\s\-_/]+/).filter(w => w.length > 1);
  let bestWordSim = 0;
  for (const word of candidateWords) {
    const ws = similarityScore(q, word);
    if (ws > bestWordSim) bestWordSim = ws;
  }

  // Return the best score from any method
  return Math.max(fullSim, bestWordSim);
}

class SearchEngine {
  constructor(libraryPaths = []) {
    if (!libraryPaths || libraryPaths.length === 0) {
      const home = os.homedir();
      libraryPaths = [
        path.join(home, 'Music', 'AutoDJ'),
        path.join(home, 'Music', 'Library'),
        path.join(home, 'Music', 'MP3'),
        path.join(home, 'Music', 'MP3s'),
        path.join(home, 'Music', 'Ripped MP3'),
      ];
    }
    this.libraryPaths = libraryPaths.filter(p => fs.existsSync(p));
    this.index = [];
    this.lastRebuild = 0;
    this.rebuildInterval = 30 * 60 * 1000; // 30 minutes

    console.log(`[SearchEngine] Initialized with ${this.libraryPaths.length} library paths`);
    this.rebuildIndex();
  }

  rebuildIndex() {
    console.log(`[SearchEngine] Rebuilding library index...`);
    this.index = [];

    const walk = (dir, results = []) => {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              walk(fullPath, results);
            } else if (file.toLowerCase().endsWith('.mp3')) {
              results.push(fullPath);
            }
          } catch {
            // Skip if can't stat
          }
        }
      } catch (e) {
        // Ignore walk errors
      }
      return results;
    };

    let totalMp3s = 0;
    for (const libPath of this.libraryPaths) {
      const mp3Files = walk(libPath);
      console.log(`[SearchEngine] Found ${mp3Files.length} MP3s in ${libPath}`);
      totalMp3s += mp3Files.length;

      for (const filePath of mp3Files) {
        try {
          const baseName = path.basename(filePath, '.mp3');
          const folder = path.basename(path.dirname(filePath));

          // Parse "Artist - Title" or just "Title"
          let artist = 'Unknown', title = baseName;
          const match = baseName.match(/^(.+?)\s*-\s*(.+)$/);
          if (match) {
            artist = match[1].trim();
            title = match[2].trim();
          }

          this.index.push({
            path: filePath,
            artist,
            title,
            album: 'Unknown',
            genre: 'Unknown',
            filename: baseName,
            folder,
          });
        } catch (e) {
          // Skip indexing errors
        }
      }
    }

    // Deduplicate by artist+title (lowercase), keeping shorter path (canonical copy)
    const seen = new Map();
    for (const track of this.index) {
      const key = `${track.artist.toLowerCase()}::${track.title.toLowerCase()}`;
      if (seen.has(key)) {
        const existing = seen.get(key);
        if (track.path.length < existing.path.length) {
          seen.set(key, track);
        }
      } else {
        seen.set(key, track);
      }
    }
    const beforeDedup = this.index.length;
    this.index = Array.from(seen.values());
    const dupsRemoved = beforeDedup - this.index.length;
    if (dupsRemoved > 0) {
      console.log(`[SearchEngine] Removed ${dupsRemoved} duplicate tracks`);
    }

    this.lastRebuild = Date.now();
    console.log(`[SearchEngine] Index rebuilt: ${this.index.length} total tracks`);
  }

  /**
   * Search the library for tracks matching a query.
   * @param {string} query - Search term (artist name, song title, genre folder, etc.)
   * @param {number} minScore - Minimum match score (0.0–1.0), default 0.5
   * @returns {Array} Matching tracks sorted by confidence (descending)
   */
  search(query, minScore = 0.5) {
    // Rebuild if stale
    if (Date.now() - this.lastRebuild > this.rebuildInterval) {
      this.rebuildIndex();
    }

    const results = [];

    for (const track of this.index) {
      // Score against multiple fields
      const scores = [
        matchScore(query, track.artist),
        matchScore(query, track.title),
        matchScore(query, track.filename),
        matchScore(query, track.folder),
        matchScore(query, `${track.artist} - ${track.title}`),
      ];

      const bestScore = Math.max(...scores);

      if (bestScore >= minScore) {
        results.push({
          ...track,
          confidence: bestScore,
        });
      }
    }

    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  }

  /**
   * Return the single best match for a query, or null.
   */
  searchBest(query) {
    const results = this.search(query, 0.5);
    return results.length > 0 ? results[0] : null;
  }
}

module.exports = { SearchEngine };

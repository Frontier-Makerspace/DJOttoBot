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

class SearchEngine {
  constructor(libraryPaths = []) {
    // Default to the AutoDJ music locations if not specified
    if (!libraryPaths || libraryPaths.length === 0) {
      const home = os.homedir();
      libraryPaths = [
        path.join(home, 'Music', 'AutoDJ'),
        path.join(home, 'Music', 'Library'),
        path.join(home, 'Music', 'MP3'),
        path.join(home, 'Music', 'MP3s'),
        path.join(home, 'Music', 'Ripped MP3'), // New organized folder
      ];
    }
    this.libraryPaths = libraryPaths.filter(p => fs.existsSync(p));
    this.index = [];
    this.lastRebuild = 0;
    this.rebuildInterval = 5 * 60 * 1000; // 5 minutes

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
      const mpgFiles = walk(libPath);
      console.log(`[SearchEngine] Found ${mpgFiles.length} MP3s in ${libPath}`);
      totalMp3s += mpgFiles.length;

      for (const filePath of mpgFiles) {
        try {
          // Extract metadata from filename/path
          const baseName = path.basename(filePath, '.mp3');
          
          // Try to parse: "Artist - Title" or just "Title"
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
          });
        } catch (e) {
          // Skip indexing errors
        }
      }
    }

    this.lastRebuild = Date.now();
    console.log(`[SearchEngine] Index rebuilt: ${this.index.length} total tracks`);
  }

  search(query, minScore = 0.6) {
    // Rebuild if stale
    if (Date.now() - this.lastRebuild > this.rebuildInterval) {
      this.rebuildIndex();
    }

    const queryLower = query.toLowerCase();
    const results = [];

    for (const track of this.index) {
      // Match on: "Artist - Title" or just Title or filename
      const searchCandidates = [
        `${track.artist} - ${track.title}`,
        track.title,
        track.filename,
      ];

      let bestScore = 0;
      for (const candidate of searchCandidates) {
        const score = similarityScore(candidate, queryLower);
        if (score > bestScore) bestScore = score;
      }

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

  searchBest(query) {
    const results = this.search(query, 0.5);
    return results.length > 0 ? results[0] : null;
  }
}

module.exports = { SearchEngine };

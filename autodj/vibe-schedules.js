function getVibeForHour(hour) {
  if (hour >= 0 && hour < 7) {
    return {
      name: 'Late Night',
      localOnly: true,
      tags: ['goth', 'industrial', 'shoegaze', 'ebm', 'darkwave', 'dark wave', 'post-punk', 'cold wave'],
      queries: [],
    };
  }
  if (hour >= 7 && hour < 12) {
    return {
      name: 'Afternoon',
      localOnly: true,
      tags: ['house', 'deep house', 'nu disco'],
      queries: [],
    };
  }
  if (hour >= 12 && hour < 17) {
    return {
      name: 'Antenna Club',
      localOnly: true,
      tags: ['80s', 'antenna'],
      queries: [],
    };
  }
  if (hour >= 17 && hour < 22) {
    return {
      name: 'Evening',
      localOnly: true,
      tags: ['goth', 'industrial', 'shoegaze', 'ebm', 'darkwave', 'dark wave', 'post-punk', 'cold wave'],
      queries: [],
    };
  }
  // 22-23
  return {
    name: 'Peak Hours',
    localOnly: true,
    tags: ['hard techno', 'industrial', 'dark industrial'],
    queries: [],
  };
}

module.exports = { getVibeForHour };

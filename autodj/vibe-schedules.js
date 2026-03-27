function getVibeForHour(hour) {
  if (hour >= 0 && hour < 7) {
    return {
      name: 'Late Night',
      localOnly: true,
      tags: ['KMFDM', 'Depeche Mode', 'Nine Inch Nails'],
      queries: [],
    };
  }
  if (hour >= 7 && hour < 12) {
    return {
      name: 'Afternoon',
      localOnly: true,
      tags: ['Antenna', 'Corey Hart', 'Duran Duran'],
      queries: [],
    };
  }
  if (hour >= 12 && hour < 17) {
    return {
      name: 'Antenna Club',
      localOnly: true,
      tags: ['Antenna'],
      queries: [],
    };
  }
  if (hour >= 17 && hour < 22) {
    return {
      name: 'Evening',
      localOnly: true,
      tags: ['Front 242', 'Combichrist', 'KMFDM', 'Nine Inch Nails', 'Covenant', 'Assemblage 23', 'And One'],
      queries: [],
    };
  }
  // 22-23
  return {
    name: 'Peak Hours',
    localOnly: true,
    tags: ['KMFDM', 'Front 242', 'Covenant', 'Combichrist', 'Nine Inch Nails'],
    queries: [],
  };
}

module.exports = { getVibeForHour };

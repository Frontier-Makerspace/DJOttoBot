function getVibeForHour(hour) {
  if (hour >= 0 && hour < 7) {
    return {
      name: 'Late Night',
      queries: [
        'dark ambient electronic',
        'EBM industrial late night',
        'cold wave minimal synth',
      ],
    };
  }
  if (hour >= 7 && hour < 12) {
    return {
      name: 'Morning',
      queries: [
        'lo-fi hip hop chill',
        'ambient electronic morning',
        'downtempo chill beats',
      ],
    };
  }
  if (hour >= 12 && hour < 18) {
    return {
      name: 'Afternoon',
      queries: [
        'house music mix',
        'deep house electronic',
        'nu disco funky house',
      ],
    };
  }
  if (hour >= 18 && hour < 22) {
    return {
      name: 'Evening',
      queries: [
        'techno set',
        'dark techno industrial',
        'EBM electronic body music',
      ],
    };
  }
  // 22-23
  return {
    name: 'Peak Hours',
    queries: [
      'hard techno peak hour',
      'industrial techno set',
      'dark electro peak',
    ],
  };
}

module.exports = { getVibeForHour };

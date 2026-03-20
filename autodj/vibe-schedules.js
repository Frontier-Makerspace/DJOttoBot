function getVibeForHour(hour) {
  if (hour >= 0 && hour < 7) {
    return {
      name: 'Late Night',
      queries: [
        'darkwave goth electronic',
        'cold wave minimal synth',
        'dark ambient industrial',
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
        'darkwave goth electronic',
        'EBM industrial electronic body music',
        'goth industrial synthpop',
      ],
    };
  }
  // 22-23
  return {
    name: 'Peak Hours',
    queries: [
      'hard EBM industrial peak',
      'dark electro aggrotech',
      'gothic industrial dance',
    ],
  };
}

module.exports = { getVibeForHour };

function getVibeForHour(hour) {
  if (hour >= 0 && hour < 7) {
    return {
      name: 'Late Night',
      localOnly: true,
      tags: ['goth', 'industrial', 'shoegaze', 'ebm', 'darkwave', 'dark wave', 'post-punk', 'cold wave'],
      queries: [
        'Sisters of Mercy official music video',
        'Bauhaus dark wave song',
        'Siouxsie and the Banshees official',
        'cold wave minimal synth single',
        'Lebanon Hanover official video',
        'She Wants Revenge official',
        'She Past Away official music video',
        'Clan of Xymox song',
        'Drab Majesty official video',
        'Boy Harsher official music video',
      ],
    };
  }
  if (hour >= 7 && hour < 12) {
    return {
      name: 'Afternoon',
      localRatio: 0.7,
      queries: [
        'Disclosure official music video',
        'Fred Again official song',
        'Jamie xx official video',
        'Peggy Gou official music video',
        'Mall Grab official song',
        'Bicep official music video',
        'Four Tet official song',
        'Job Jobse official set',
        'Solomun official music video',
        'Floating Points official song',
      ],
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
      queries: [
        'Front 242 official music video',
        'Nitzer Ebb official song',
        'Skinny Puppy official video',
        'ADULT. official music video',
        'Boy Harsher official song',
        'Lebanon Hanover official video',
        'She Past Away official',
        'Soft Moon official music video',
        'Molchat Doma official song',
        'Drab Majesty official video',
      ],
    };
  }
  // 22-23
  return {
    name: 'Peak Hours',
    localRatio: 0.7,
    queries: [
      'Combichrist official music video',
      'Wumpscut official song',
      'Suicide Commando official video',
      'Assemblage 23 official music video',
      'VNV Nation official song',
      'Icon of Coil official video',
      'Covenant band official music video',
      'Haujobb official song',
      'Funker Vogt official video',
      'Aesthetic Perfection official music video',
    ],
  };
}

module.exports = { getVibeForHour };

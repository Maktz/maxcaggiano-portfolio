export interface Project {
  code: string;
  year: string;
  client: string;
  title: string;
  tags: string[];
  kpi: string;
  brief: string;
  role: string;
  timeline: string;
  deliverables: string[];
  strategy: string;
  galleryImages: string[];
  liveUrl: string;
  metrics: { label: string; value: string }[];
}

export const projects: Project[] = [
  {
    code: 'EXP_01',
    year: '2026',
    client: 'NEONLABS',
    title: 'CHROMATIC PROTOCOL',
    tags: ['BRAND STRATEGY', '3D EXPERIENCE', 'CAMPAIGN'],
    kpi: '+180% ENGAGEMENT',
    brief: 'Orchestrated a full-spectrum brand identity reboot for a generative AI lab, blending Swiss precision with chromatic chaos.',
    role: 'Art Director & Creative Strategist',
    timeline: 'Q2 2026',
    deliverables: ['Brand Identity', 'Campaign', 'Motion', 'Web Architecture'],
    strategy:
      'The Chromatic Protocol was born from a simple tension: how do you visualize a machine that thinks in color? We built a generative grid system where every brand touchpoint is a live computation — logos that breathe, layouts that shift based on viewer dwell time, and a motion language derived from the golden ratio. The result is an identity that is never the same twice, yet always unmistakably NEONLABS.',
    galleryImages: [
      'https://images.pexels.com/photos/28494632/pexels-photo-28494632.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/30066060/pexels-photo-30066060.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/28398621/pexels-photo-28398621.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    ],
    liveUrl: 'https://example.com/chromatic-protocol',
    metrics: [
      { label: 'ENGAGEMENT', value: '+180%' },
      { label: 'IMPRESSIONS', value: '2.4M' },
      { label: 'AWARDS', value: '3' },
    ],
  },
  {
    code: 'EXP_02',
    year: '2026',
    client: 'MAISON RUGE',
    title: 'PIGMENT REBELLION',
    tags: ['FASHION', 'ART DIRECTION', 'CAMPAIGN'],
    kpi: '2.4M IMPRESSIONS',
    brief: 'Directed a defiant fashion campaign that turned traditional lookbooks into a kinetic street-level art intervention.',
    role: 'Art Director & Creative Strategist',
    timeline: 'Q1 2026',
    deliverables: ['Campaign', 'Art Direction', 'Motion', 'Print'],
    strategy:
      'Pigment Rebellion rejected the sterile studio. We took the collection to the streets of three cities, shooting against raw urban backdrops with a single rule: every frame must contain a clash of at least three saturated pigments. The campaign film was edited to the rhythm of a heartbeat, not a beat drop — making the viewer feel the clothes as a physical experience.',
    galleryImages: [
      'https://images.pexels.com/photos/9953932/pexels-photo-9953932.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/9953928/pexels-photo-9953928.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/11493117/pexels-photo-11493117.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    ],
    liveUrl: 'https://example.com/pigment-rebellion',
    metrics: [
      { label: 'IMPRESSIONS', value: '2.4M' },
      { label: 'SAVE RATE', value: '+92%' },
      { label: 'PRESS FEATURES', value: '14' },
    ],
  },
  {
    code: 'EXP_03',
    year: '2025',
    client: 'KINETIC FOUNDRY',
    title: 'MOTION GRIMOIRE',
    tags: ['MOTION DESIGN', '3D EXPERIENCE', 'WEB'],
    kpi: '+340% DWELL TIME',
    brief: 'Built an interactive motion library for a type foundry, turning font specimens into living, deformable organisms.',
    role: 'Art Director & Motion Lead',
    timeline: 'Q4 2025',
    deliverables: ['Motion Library', 'Web Architecture', '3D Experience', 'Brand Identity'],
    strategy:
      'The Motion Grimoire treats every typeface as a living specimen. We built a WebGL playground where users can stretch, skew, and breathe life into letterforms in real time. Each font ships with its own motion DNA — spring constants, easing curves, and deformation limits — so the animation is an extension of the typography itself, not a layer on top.',
    galleryImages: [
      'https://images.pexels.com/photos/30066061/pexels-photo-30066061.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/18337610/pexels-photo-18337610.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/36008924/pexels-photo-36008924.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    ],
    liveUrl: 'https://example.com/motion-grimoire',
    metrics: [
      { label: 'DWELL TIME', value: '+340%' },
      { label: 'CONVERSIONS', value: '+67%' },
      { label: 'FONTS LICENSED', value: '1,200+' },
    ],
  },
  {
    code: 'EXP_04',
    year: '2025',
    client: 'BOTANICA STUDIO',
    title: 'SOFT MACHINE',
    tags: ['PACKAGING', 'BRAND STRATEGY', 'ART DIRECTION'],
    kpi: '500K UNITS SOLD',
    brief: 'Crafted a tactile packaging system for a clean-beauty brand, where every box is a mini-gallery of botanical geometry.',
    role: 'Art Director & Brand Strategist',
    timeline: 'Q3 2025',
    deliverables: ['Packaging', 'Brand Identity', 'Photography', 'Retail Design'],
    strategy:
      'Soft Machine makes packaging feel like opening a gift. We used a single die-cut window that reveals a different botanical illustration depending on the product, creating a collectible system. The unboxing film became the brand\'s most shared asset — proof that restraint, executed with obsessive detail, outperforms noise.',
    galleryImages: [
      'https://images.pexels.com/photos/4841519/pexels-photo-4841519.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/9594416/pexels-photo-9594416.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/16605642/pexels-photo-16605642.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    ],
    liveUrl: 'https://example.com/soft-machine',
    metrics: [
      { label: 'UNITS SOLD', value: '500K' },
      { label: 'REPEAT PURCHASE', value: '+45%' },
      { label: 'RETAIL DOORS', value: '320' },
    ],
  },
  {
    code: 'EXP_05',
    year: '2025',
    client: 'GALERIE NOIR',
    title: 'INFINITE ROOM',
    tags: ['EXHIBITION', '3D EXPERIENCE', 'ART DIRECTION'],
    kpi: '120K VISITORS',
    brief: 'Designed a hybrid physical-digital exhibition where visitors walk through a gallery that rebuilds itself around them.',
    role: 'Art Director & Spatial Designer',
    timeline: 'Q2 2025',
    deliverables: ['Exhibition Design', '3D Experience', 'Campaign', 'Web'],
    strategy:
      'Infinite Room used projection mapping and spatial audio to create a gallery that responds to footfall. As visitors move through the space, the walls shift — artworks grow, contract, and migrate between rooms. The web companion lets remote visitors influence the physical space in real time, collapsing the distance between the gallery and the world.',
    galleryImages: [
      'https://images.pexels.com/photos/29608796/pexels-photo-29608796.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/39648244/pexels-photo-39648244.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/34909191/pexels-photo-34909191.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    ],
    liveUrl: 'https://example.com/infinite-room',
    metrics: [
      { label: 'VISITORS', value: '120K' },
      { label: 'AVG. DWELL', value: '47min' },
      { label: 'PRESS', value: '28' },
    ],
  },
  {
    code: 'EXP_06',
    year: '2024',
    client: 'SIGNAL & CO.',
    title: 'STATIC CARNIVAL',
    tags: ['CAMPAIGN', 'BRAND STRATEGY', 'MOTION'],
    kpi: '+210% BRAND RECALL',
    brief: 'Launched a telecom brand with a campaign that turned signal interference into a visual language of celebration.',
    role: 'Art Director & Creative Lead',
    timeline: 'Q4 2024',
    deliverables: ['Campaign', 'Brand Identity', 'Motion', 'OOH'],
    strategy:
      'Static Carnival embraced the glitch. Where telecom brands hide signal noise, we made it the hero. Every ad break started with a burst of static that resolved into a carnival of color. The visual system was built from real signal data — interference patterns from cell towers became the brand\'s texture library.',
    galleryImages: [
      'https://images.pexels.com/photos/7661590/pexels-photo-7661590.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/7661184/pexels-photo-7661184.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/15635403/pexels-photo-15635403.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    ],
    liveUrl: 'https://example.com/static-carnival',
    metrics: [
      { label: 'BRAND RECALL', value: '+210%' },
      { label: 'REACH', value: '8.1M' },
      { label: 'MARKET SHARE', value: '+3.2pt' },
    ],
  },
];

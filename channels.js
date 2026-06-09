(function () {
  const BASE_CHANNELS = [
    { title: "0N Radio", slug: "0n-radio" },
    { title: "0N 50s", slug: "0n-50s" },
    { title: "0N 60s", slug: "0n-60s" },
    { title: "0N 70s", slug: "0n-70s" },
    { title: "0N 80s", slug: "0n-80s" },
    { title: "0N 90s", slug: "0n-90s" },
    { title: "0N 2000s", slug: "0n-2000s" },
    { title: "0N 2010s", slug: "0n-2010s" },
    { title: "0N Hits", slug: "0n-hits" },
    { title: "0N Greatest Hits", slug: "0n-greatesthits", slugs: ["0n-greatest-hits"] },
    { title: "0N Charts", slug: "0n-charts" },
    { title: "0N Top 40", slug: "0n-top40", slugs: ["0n-top-40"] },
    { title: "0N Hot", slug: "0n-hot" },
    { title: "0N Pop", slug: "0n-pop" },
    { title: "0N Oldies", slug: "0n-oldies" },
    { title: "0N Evergreens", slug: "0n-evergreens" },
    { title: "0N Gold", slug: "0n-gold" },
    { title: "0N Jukebox", slug: "0n-jukebox" },
    { title: "0N Rock", slug: "0n-rock" },
    { title: "0N Black", slug: "0n-black" },
    { title: "0N Dance", slug: "0n-dance" },
    { title: "0N Schlager", slug: "0n-schlager" },
    { title: "0N Jazz", slug: "0n-jazz" },
    { title: "0N Chillout", slug: "0n-chillout" },
    { title: "0N Relax", slug: "0n-relax" },
    { title: "0N Lounge", slug: "0n-lounge" },
    { title: "0N Soft Pop", slug: "0n-softpop", slugs: ["0n-soft-pop"] },
    { title: "0N Love", slug: "0n-love" },
    { title: "0N Volksmusik", slug: "0n-volksmusik" },
    { title: "0N Country", slug: "0n-country" },
    { title: "0N Schlager Kult", slug: "0n-schlagerkult", slugs: ["0n-schlager-kult"] },
    { title: "0N Schlager Gold", slug: "0n-schlagergold", slugs: ["0n-schlager-gold"] },
    { title: "0N Party", slug: "0n-party" },
    { title: "0N Deutsch Pop", slug: "0n-deutschpop", slugs: ["0n-deutsch-pop"] },
    { title: "0N Deutsch Rap", slug: "0n-deutschrap", slugs: ["0n-deutsch-rap"] },
    { title: "0N Disco", slug: "0n-disco" },
    { title: "0N Techno", slug: "0n-techno" },
    { title: "0N House", slug: "0n-house" },
    { title: "0N Electro", slug: "0n-electro" },
    { title: "0N Gothic", slug: "0n-gothic" },
    { title: "0N New Wave", slug: "0n-newwave", slugs: ["0n-new-wave"] },
    { title: "0N Indie", slug: "0n-indie" },
    { title: "0N Classic Rock", slug: "0n-classicrock", slugs: ["0n-classic-rock"] },
    { title: "0N Heavy Metal", slug: "0n-heavymetal", slugs: ["0n-heavy-metal"] },
    { title: "0N Deutsch Rock", slug: "0n-deutschrock", slugs: ["0n-deutsch-rock"] },
    { title: "0N Soft Rock", slug: "0n-softrock", slugs: ["0n-soft-rock"] },
    { title: "0N Smooth Jazz", slug: "0n-smoothjazz", slugs: ["0n-smooth-jazz"] },
    { title: "0N Blues", slug: "0n-blues" },
    { title: "0N Klassik", slug: "0n-klassik" },
    { title: "0N Movies", slug: "0n-movies" },
    { title: "0N Reggae", slug: "0n-reggae" },
    { title: "0N Latin", slug: "0n-latin" },
    { title: "0N K-Pop", slug: "0n-kpop", slugs: ["0n-k-pop"] },
    { title: "0N Gay", slug: "0n-gay" },
    { title: "0N Christmas", slug: "0n-christmas" },
    { title: "0N Weihnachten", slug: "0n-weihnachten" },
    { title: "BurnFM", slug: "burnfm", slugs: ["burn-fm"] }
  ];

  function unique(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
      const clean = String(value || "").trim().toLowerCase();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        result.push(clean);
      }
    }
    return result;
  }

  function titleToSlugVariants(title) {
    const raw = String(title || "")
      .replace(/^0\s*N\s*/i, "")
      .replace(/^0N\s*/i, "")
      .trim();

    if (!raw) return [];
    if (/^burn\s*-?\s*fm$/i.test(raw)) return ["burnfm", "burn-fm"];

    const normalized = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return unique([
      `0n-${normalized.replace(/-/g, "")}`,
      `0n-${normalized}`
    ]);
  }

  window.ON_CHANNELS = BASE_CHANNELS.map((channel) => {
    const slugs = unique([
      channel.slug,
      ...(channel.slugs || []),
      ...titleToSlugVariants(channel.title)
    ]);
    return { ...channel, slugs };
  });


  window.CMP_PROVIDERS = {
    on: {
      id: "on",
      title: "ON Radio",
      shortTitle: "ON",
      defaultChannel: "0n-jukebox",
      searchPlaceholder: "z. B. Rock, Pop, K-Pop"
    },
    "80s80s": {
      id: "80s80s",
      title: "80s80s",
      shortTitle: "80s",
      defaultChannel: "web",
      searchPlaceholder: "z. B. Rock, Wave, Soul"
    }
  };

  window.CMP_DEFAULT_PROVIDER = "on";

  window.ON_DEFAULTS = {
    channel: "0n-jukebox",
    country: "DE",
    coverSize: 1000,
    refreshSeconds: 15,
    quality: 100
  };
})();

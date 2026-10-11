/*
 * Default content. The server copies this into data/site.json the first time it starts;
 * after that everything is edited from the private dashboard and this file is only a fallback
 * (used if the page is opened without the server).
 */
window.PORTFOLIO = {
  brand: {
    name: "BlueToon",
    years: 8,
    tagline: "Video editing for YouTube creators",
    heroLine: "I cut videos that hold attention from the first frame to the last.",
    logo: "assets/bluetoon-logo.jpg",
  },

  // Look of the site. Colours, fonts, corners and effects are changed from the dashboard (Design tab).
  theme: {
    preset: "cobalt",
    colors: { bg: "#060b1a", panel: "#0d1738", fg: "#eaf0ff", muted: "#93a0c8", accent: "#2f6bff", accent2: "#6fa0ff" },
    fonts: "studio",
    corners: "soft",
    effects: { grain: true, cursor: true, timeline: true, ghost: true, portrait: true, rec: true },
  },

  channels: [
    {
      id: "restextra",
      name: "REST EXTRA",
      handle: "@RESTEXTRA",
      url: "https://www.youtube.com/@RESTEXTRA",
      avatar: "assets/restextra-avatar.jpg",
      banner: null,
      monogram: "RE",
      blurb: "Arabic Minecraft channel covering survival, hardcore, challenges and speedruns.",
    },
    {
      id: "xbluetoon",
      name: "xBlue | بلو",
      handle: "@XBlueToon",
      url: "https://www.youtube.com/@XBlueToon",
      avatar: "assets/xbluetoon-avatar.jpg",
      banner: null,
      monogram: "xB",
      blurb: "Blue's main Minecraft channel, presented in Arabic.",
    },
  ],

  videos: [
    { id: "nCTviJ3nI-c", title: "ختمت ماين كرافت بدون أرض !!", channelId: "restextra", channelName: "REST EXTRA" },
    { id: "BZ7qVfSoqbE" },
    { id: "u6bYS7ldHE0" },
    { id: "2hOMQswqoNs" },
    { id: "0MHxgqWA93w" },
    { id: "9ZGrKfiC7PQ" },
    { id: "ZfIw0wJS3MI" },
    { id: "e2qhUV6hcik" },
    { id: "jcUBqGhL11E" },
    { id: "D1WJZ4rw_tY" },
    { id: "kjrOfRugj9Q" },
    { id: "s0uIO8_0r_E" },
    { id: "rOxec0YSovw" },
    { id: "mU9xHnGRpFk" },
    { id: "yPSgpu3ZPc0" },
  ],

  services: [
    { title: "Long-form editing", text: "Pacing, cuts and structure that keep a 10 to 30 minute video moving from the first second to the last." },
    { title: "Short-form edits", text: "Vertical cuts built for Shorts, Reels and TikTok: tight hooks, clear captions, no wasted frames." },
    { title: "Motion and titles", text: "Animated text, transitions and overlays that match the channel's look instead of fighting it." },
    { title: "Sound and rhythm", text: "Music, effects and silence placed on the beat so jokes land and moments hit." },
    { title: "Channel style guide", text: "A repeatable editing language for your channel, so every upload feels like the same show." },
  ],

  about: [
    "I'm BlueToon, a video editor with more than eight years of experience cutting content for YouTube creators.",
    "My work is about rhythm: knowing when to cut, when to hold, and when to let a moment breathe. I edit for the viewer first and for the algorithm second.",
    "Below you can watch real projects from channels I have worked with, without leaving this page.",
  ],

  accounts: [
    { id: "email", type: "email", label: "Email", value: "xblue1094@gmail.com" },
    { id: "discord", type: "discord", label: "Discord", value: "bluetoon_" },
    { id: "instagram", type: "instagram", label: "Instagram", value: "@its.bluetoon", url: "https://www.instagram.com/its.bluetoon" },
    { id: "youtube", type: "youtube", label: "YouTube", value: "@XBlueToon", url: "https://www.youtube.com/@XBlueToon" },
  ],
};

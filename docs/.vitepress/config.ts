import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Loica',
  description: 'Documentation for Loica — a self-hosted, real-time collaborative Markdown editor',
  base: '/loica/',

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/loica/loica-icon.png' }],
  ],

  themeConfig: {
    logo: {
      light: '/loica-icon.png',
      dark: '/loica-icon-dark.png',
    },
    siteTitle: 'Loica',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Deployment', link: '/deployment' },
      { text: 'Development', link: '/development' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Features', link: '/guide/features' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Deployment', link: '/deployment' },
          { text: 'Development', link: '/development' },
        ],
      },
    ],

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/critica-tech-lab/loica' },
    ],

    footer: {
      message: 'AGPL-3.0 licensed.',
      copyright: 'Named after the <a href="https://en.wikipedia.org/wiki/Long-tailed_meadowlark">Loica</a>, a Chilean bird.',
    },
  },
})

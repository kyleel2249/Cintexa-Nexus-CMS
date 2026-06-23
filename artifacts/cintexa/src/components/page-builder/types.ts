export type BlockType = "hero" | "feature" | "cta" | "text" | "image";

export interface HeroBlock {
  type: "hero";
  id: string;
  heading: string;
  subheading: string;
  ctaLabel: string;
  ctaUrl: string;
  backgroundImage: string;
}

export interface FeatureItem {
  icon: string;
  title: string;
  description: string;
}

export interface FeatureBlock {
  type: "feature";
  id: string;
  heading: string;
  subheading: string;
  features: FeatureItem[];
}

export interface CtaBlock {
  type: "cta";
  id: string;
  heading: string;
  body: string;
  primaryLabel: string;
  primaryUrl: string;
  secondaryLabel: string;
  secondaryUrl: string;
}

export interface TextBlock {
  type: "text";
  id: string;
  heading: string;
  body: string;
}

export interface ImageBlock {
  type: "image";
  id: string;
  src: string;
  alt: string;
  caption: string;
}

export type Block = HeroBlock | FeatureBlock | CtaBlock | TextBlock | ImageBlock;

export interface BlockPaletteItem {
  type: BlockType;
  label: string;
  description: string;
  icon: string;
  defaultData: Omit<Block, "id" | "type">;
}

export const BLOCK_PALETTE: BlockPaletteItem[] = [
  {
    type: "hero",
    label: "Hero",
    description: "Full-width banner with headline and CTA",
    icon: "🦸",
    defaultData: {
      heading: "Welcome to Our Platform",
      subheading: "Everything you need to build, launch, and grow your digital presence.",
      ctaLabel: "Get Started",
      ctaUrl: "#",
      backgroundImage: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200",
    },
  },
  {
    type: "feature",
    label: "Features",
    description: "Three-column feature highlights grid",
    icon: "⚡",
    defaultData: {
      heading: "Why Choose Us",
      subheading: "Built for teams who demand the best",
      features: [
        { icon: "⚡", title: "Blazing Fast", description: "Optimized for performance at any scale." },
        { icon: "🔒", title: "Secure by Default", description: "Enterprise-grade security built in." },
        { icon: "🌐", title: "Global Reach", description: "Deploy anywhere, reach everyone." },
      ],
    },
  },
  {
    type: "cta",
    label: "Call to Action",
    description: "Conversion-focused CTA section",
    icon: "🎯",
    defaultData: {
      heading: "Ready to get started?",
      body: "Join thousands of teams already using our platform to build better products faster.",
      primaryLabel: "Start Free Trial",
      primaryUrl: "#",
      secondaryLabel: "Learn More",
      secondaryUrl: "#",
    },
  },
  {
    type: "text",
    label: "Text",
    description: "Heading with rich body text",
    icon: "📝",
    defaultData: {
      heading: "Your Heading Here",
      body: "Add your content here. This section is great for telling your story, explaining a concept, or sharing important information with your audience.",
    },
  },
  {
    type: "image",
    label: "Image",
    description: "Full-width image with caption",
    icon: "🖼️",
    defaultData: {
      src: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200",
      alt: "Team collaboration",
      caption: "Our team working together to build amazing products",
    },
  },
];

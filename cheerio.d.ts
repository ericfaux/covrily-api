declare module "cheerio" {
  interface CheerioRoot {
    (selector?: string): { text(): string };
    text(): string;
  }
  export function load(html: string): CheerioRoot;
}

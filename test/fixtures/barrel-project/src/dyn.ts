export async function loadLocale(lang: string): Promise<unknown> {
  return import(`./locales/${lang}`);
}

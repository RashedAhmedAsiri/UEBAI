import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "katex/dist/katex.min.css";
import "./globals.css";
import { I18nProvider } from "@/lib/client/i18n";
import { LANG_COOKIE, type Lang } from "@/lib/i18n/translate";
import { AppHeader } from "@/components/AppHeader";
import { IntroSplash } from "@/components/IntroSplash";
import { Toasts } from "@/components/Toasts";
import { WallBackground } from "@/components/WallBackground";

async function currentLang(): Promise<Lang> {
  // Arabic is the default; English only when the visitor switched to it.
  return (await cookies()).get(LANG_COOKIE)?.value === "en" ? "en" : "ar";
}

export async function generateMetadata(): Promise<Metadata> {
  const ar = (await currentLang()) === "ar";
  return {
    title: ar ? "UEBAI — اصنع معلّمك الآلي" : "UEBAI — Build Your Own AI Teacher",
    description: ar
      ? "اصنع معلّمك الآلي وألبسه وبرمج شخصيته، وأعطه كتبك ليحفظ كل موضوع مرة واحدة فقط."
      : "Build, dress and program your own robot teacher. Feed it your books; it files every topic once.",
  };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#d9dcda" };

const FONTS =
  "https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Nunito:wght@400;600;700&family=Cabin+Sketch:wght@400;700&family=Gochi+Hand&family=Aref+Ruqaa:wght@400;700&family=Special+Elite&display=swap";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await currentLang();
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>
        <WallBackground />
        <IntroSplash lang={lang} />
        <I18nProvider initialLang={lang}>
          <AppHeader />
          {children}
          <Toasts />
        </I18nProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import ConvexClientProvider from './providers';
import '../styles.css';
import '../theme-dark.css';
export const metadata: Metadata={title:'APIPassage — See the path through every API.',description:'Turn API documentation into an interactive map of entities, ID dependencies, and workflows. Explore with APIPassage.',icons:{icon:'/favicon.svg'}};
// Applies the saved theme before first paint (no light flash in dark mode).
const THEME_BOOT=`try{var t=localStorage.getItem('apipassage-theme')||localStorage.getItem('atlas-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}`;
export const viewport: Viewport={themeColor:'#f8f9fc'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:THEME_BOOT}}/></head><body><ClerkProvider><ConvexClientProvider>{children}</ConvexClientProvider></ClerkProvider></body></html>;}

'use client';
import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { readBrandStorage } from '../brandStorage';

type Theme='light'|'dark'|'system';
const apply=(theme:Theme)=>{const dark=theme==='dark'||(theme==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light'};

export default function ThemeToggle(){
 const [theme,setTheme]=useState<Theme>(()=>typeof window==='undefined'?'system':(readBrandStorage('apipassage-theme','atlas-theme') as Theme)||'system');
 useEffect(()=>{
  apply(theme);try{localStorage.setItem('apipassage-theme',theme)}catch{}
  if(theme!=='system')return;
  const media=window.matchMedia('(prefers-color-scheme: dark)');const onChange=()=>apply('system');media.addEventListener('change',onChange);return()=>media.removeEventListener('change',onChange);
 },[theme]);
 const options:[Theme,typeof Sun,string][]=[['light',Sun,'Light'],['dark',Moon,'Dark'],['system',Monitor,'System']];
 return <div className="theme-toggle" role="radiogroup" aria-label="Color theme">{options.map(([value,Icon,label])=><button key={value} role="radio" aria-checked={theme===value} className={theme===value?'active':''} onClick={()=>setTheme(value)} title={label}><Icon size={13}/><span>{label}</span></button>)}</div>;
}

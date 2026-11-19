import { Injectable } from '@angular/core';

// A picture in the library (TECHNICAL-DESIGN.md 4). Shipped with the app
// in public/pictures/catalogue.json; SVG files are immutable once shipped.
export interface Picture {
  id: string;
  version: number;
  title: string;
  latinName: string;
  plate: number;
  // 'blank' is the blank page (plate 0): no index tab, listed first.
  category: 'animals' | 'plants' | 'mandalas' | 'patterns' | 'places' | 'blank';
  difficulty: 1 | 2 | 3 | 4;
  svg: string;
  docLongSide: number;
}

@Injectable({ providedIn: 'root' })
export class CatalogueService {
  private loaded: Promise<Picture[]> | null = null;

  all(): Promise<Picture[]> {
    this.loaded ??= fetch('pictures/catalogue.json')
      .then((res) => {
        if (!res.ok) throw new Error(`catalogue.json: ${res.status}`);
        return res.json() as Promise<{ pictures: Picture[] }>;
      })
      .then((body) => body.pictures)
      .catch((err: unknown) => {
        this.loaded = null;
        throw err;
      });
    return this.loaded;
  }

  async byId(id: string): Promise<Picture | undefined> {
    return (await this.all()).find((p) => p.id === id);
  }
}

// The document size for a picture: its long side from the catalogue, the
// aspect ratio from the SVG's viewBox (TECHNICAL-DESIGN.md 5.1).
export function documentSize(svgText: string, longSide: number): { width: number; height: number } {
  const match = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svgText);
  const w = match ? Number(match[1]) : 1;
  const h = match ? Number(match[2]) : 1;
  return w >= h
    ? { width: longSide, height: Math.round((longSide * h) / w) }
    : { width: Math.round((longSide * w) / h), height: longSide };
}

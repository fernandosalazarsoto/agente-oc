/**
 * Límite de peticiones en memoria por IP (ventana fija). Es una protección básica
 * contra abuso del endpoint y consumo de la API key; en serverless es por instancia.
 * Para producción: límite distribuido (Redis/Upstash) o WAF de la plataforma.
 */
export class LimitePeticiones {
  private readonly ventanas = new Map<string, { inicio: number; cuenta: number }>();

  constructor(
    private readonly maximo: number,
    private readonly ventanaMs: number,
    private readonly ahora: () => number = Date.now,
  ) {}

  permitir(clave: string): boolean {
    const t = this.ahora();
    const v = this.ventanas.get(clave);
    if (!v || t - v.inicio >= this.ventanaMs) {
      this.ventanas.set(clave, { inicio: t, cuenta: 1 });
      return true;
    }
    if (v.cuenta >= this.maximo) return false;
    v.cuenta += 1;
    return true;
  }
}

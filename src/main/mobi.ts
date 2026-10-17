// MOBI / AZW / AZW3 (PalmDB) 元数据与封面解析。
// 纯函数实现，不依赖 electron / ssh —— 便于离线对样书文件做单元验证。
//
// 文件结构：
//   0x00-0x4F  PalmDB 头（name/type/creator 等）
//   0x4C       numRecords (u16 BE)
//   0x52       记录表起始，每项 8 字节：offset(u32) + attrs(u8) + uniqueID(3B)
//   记录 0     MOBI 头（"MOBI" 魔数在记录 0 偏移 +16 处），EXTH 紧随其后
//
// 关键校验结论（真机样书验证）：
//   - EXTH 201 (coverOffset) 是相对「first image record」的资源号，
//     绝对记录索引 = record0[0x6C](firstImage) + coverOffset；
//   - azw(KF8 前身) 封面多为 JPEG，azw3 封面可能是 GIF；
//   - 老式 MOBI6 无 EXTH 时书名回退到 fullName（记录 0 内偏移）。

export interface MobiMeta {
  title?: string
  author?: string
  asin?: string
  publisher?: string
  publishDate?: string
  cdeType?: string
  /** 封面所在的绝对记录索引；-1 表示本书没有内嵌封面 */
  coverRecordIndex: number
  firstImageRecordIndex: number
}

/** PalmDB 头前 80 字节 → 记录数量（异常返回 0） */
export function readNumRecords(header80: Buffer): number {
  if (header80.length < 78 || header80.toString('ascii', 60, 64) !== 'BOOK') return 0
  return header80.readUInt16BE(76)
}

/** 记录表（78 起共 numRecords*8 字节）→ 各记录起始偏移（升序） */
export function readRecordOffsets(table: Buffer, numRecords: number): number[] {
  const offsets: number[] = []
  for (let i = 0; i < numRecords; i++) {
    const p = i * 8
    if (p + 4 > table.length) break
    offsets.push(table.readUInt32BE(p))
  }
  return offsets
}

// Windows-1252 的 0x80-0x9F 高位区（Node 原生只支持 latin1，差这 32 个字符）
const CP1252_HIGH = [
  '€', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u008D', 'Ž', '\u008F', '\u0090',
  '\u0091', '\u0092', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u009D', 'ž', 'Ÿ'
]

function decodeMobiText(buf: Buffer, encoding: number): string {
  const raw =
    encoding === 1252
      ? (() => {
          let s = ''
          for (const byte of buf) {
            s += byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : String.fromCharCode(byte)
          }
          return s
        })()
      : buf.toString('utf8')
  return decodeHtmlEntities(raw.replace(/\u0000+$/, ''))
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/** Amazon 官方书的 EXTH 文本常带 HTML 实体（如 Kindle&#12518;&#12540;&#12470;） */
function decodeHtmlEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body] ?? whole
  })
}

/**
 * 解析记录 0（MOBI 头 + EXTH）。
 * 返回 null 表示不是 MOBI 系文件（PDF/TXT 等走文件名回退）。
 */
export function parseRecord0(r0: Buffer): MobiMeta | null {
  // 需要覆盖到 firstImage(0x6C) / exthFlag(0x80) 字段
  if (r0.length < 0x84 || r0.toString('ascii', 16, 20) !== 'MOBI') return null
  const headerLength = r0.readUInt32BE(20)
  const encoding = r0.readUInt32BE(28)
  const decode = (b: Buffer): string => decodeMobiText(b, encoding)

  const meta: MobiMeta = { coverRecordIndex: -1, firstImageRecordIndex: -1 }

  // 书名回退：fullName（偏移相对记录 0 起点）
  const fullNameOffset = r0.readUInt32BE(0x54)
  const fullNameLength = r0.readUInt32BE(0x58)
  if (
    fullNameLength > 0 &&
    fullNameLength <= 2048 &&
    fullNameOffset >= 0x60 &&
    fullNameOffset + fullNameLength <= r0.length
  ) {
    meta.title = decode(r0.subarray(fullNameOffset, fullNameOffset + fullNameLength))
  }

  const firstImage = r0.readUInt32BE(0x6c)
  if (firstImage !== 0xffffffff && firstImage < 0x10000) meta.firstImageRecordIndex = firstImage

  const exthFlag = r0.readUInt32BE(0x80)
  if (exthFlag & 0x40 && r0.length >= 16 + headerLength + 12) {
    const exthOff = 16 + headerLength
    if (r0.toString('ascii', exthOff, exthOff + 4) === 'EXTH') {
      const count = r0.readUInt32BE(exthOff + 8)
      let p = exthOff + 12
      const authors: string[] = []
      for (let i = 0; i < count && p + 8 <= r0.length; i++) {
        const recType = r0.readUInt32BE(p)
        const recLen = r0.readUInt32BE(p + 4)
        if (recLen < 8 || p + recLen > r0.length) break
        const data = r0.subarray(p + 8, p + recLen)
        switch (recType) {
          case 100:
            authors.push(decode(data))
            break
          case 101:
            meta.publisher ??= decode(data)
            break
          case 106:
            meta.publishDate ??= decode(data)
            break
          case 113:
            meta.asin ??= decode(data)
            break
          case 501:
            meta.cdeType ??= decode(data)
            break
          case 503:
            meta.title ??= decode(data)
            break
          case 201: {
            const v = data.length >= 4 ? data.readUInt32BE(0) : -1
            if (meta.coverRecordIndex < 0 && v < 0x10000) meta.coverRecordIndex = v
            break
          }
        }
        p += recLen
      }
      if (authors.length) meta.author = authors.join(', ')
    }
  }

  // EXTH 封面资源号 → 绝对记录索引
  if (meta.coverRecordIndex >= 0 && meta.firstImageRecordIndex > 0) {
    meta.coverRecordIndex += meta.firstImageRecordIndex
  }
  return meta
}

export interface DetectedImage {
  mime: string
  ext: string
  start: number
}

/** 识别封面记录的图片格式；KF8 个别记录前有少量包装字节，顺带向前搜 JPEG SOI */
export function detectImageFormat(buf: Buffer): DetectedImage | null {
  if (buf.length < 16) return null
  if (buf[0] === 0xff && buf[1] === 0xd8) return { mime: 'image/jpeg', ext: 'jpg', start: 0 }
  if (buf.toString('ascii', 0, 3) === 'GIF') return { mime: 'image/gif', ext: 'gif', start: 0 }
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { mime: 'image/png', ext: 'png', start: 0 }
  }
  if (buf.toString('ascii', 0, 2) === 'BM') return { mime: 'image/bmp', ext: 'bmp', start: 0 }
  for (let i = 1; i < Math.min(512, buf.length - 3); i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      return { mime: 'image/jpeg', ext: 'jpg', start: i }
    }
  }
  return null
}

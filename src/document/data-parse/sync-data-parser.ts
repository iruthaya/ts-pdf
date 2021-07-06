import { codes, keywordCodes } from "../encoding/char-codes";
import { ValueType, valueTypes } from "../spec-constants";
import { DataParser, ParserOptions, ParserBounds, ParserResult } from "./data-parser";

export class SyncDataParser implements DataParser {
  //#region static collections
  /**
   * Each line is terminated by an end-of-line (EOL) marker
   */
  static readonly EOL = [
    codes.CARRIAGE_RETURN, 
    codes.LINE_FEED,
  ] as const;
  
  /**
   * The delimiter  characters (, ), <, >, [, ], {, }, /,  and  %  are  special.  
   * They delimit syntactic entities such as strings, arrays, names, and comments.  
   * Any of these characters terminates the entity preceding it and is not included in the entity. 
   */
  static readonly delimiterChars = new Set<number>([
    codes.PERCENT,
    codes.L_PARENTHESE,
    codes.R_PARENTHESE,
    codes.SLASH,
    codes.LESS,
    codes.GREATER,
    codes.L_BRACKET,
    codes.R_BRACKET,
    codes.L_BRACE,
    codes.R_BRACE,
  ]);
  
  /**
   * White-space characters separate syntactic constructs such as names and numbers from each other.  
   * All white-space characters are  equivalent, except in comments, strings, and streams. 
   * In all other contexts, PDF treats any sequence of consecutive white-space characters as one character.
   */
  static readonly spaceChars = new Set<number>([
    codes.NULL,
    codes.HORIZONTAL_TAB,
    codes.LINE_FEED,
    codes.FORM_FEED,
    codes.CARRIAGE_RETURN,
    codes.WHITESPACE,
  ]);
  
  static readonly digitChars = new Set<number>([
    codes.D_0,
    codes.D_1,
    codes.D_2,
    codes.D_3,
    codes.D_4,
    codes.D_5,
    codes.D_6,
    codes.D_7,
    codes.D_8,
    codes.D_9,
  ]);

  static readonly newLineChars = new Set<number>([
    codes.CARRIAGE_RETURN,
    codes.LINE_FEED,
  ]);
  //#endregion

  private readonly _data: Uint8Array;  
  private readonly _maxIndex: number;

  public get maxIndex(): number {
    return this._maxIndex;
  }

  /**
   * 
   * @param data byte array (can be the whole PDF file data, a single PDF object data, or decrypted stream data)
   */
  constructor(data: Uint8Array) {
    if (!data?.length) {
      throw new Error("Data is empty");
    }
    this._data = data;
    this._maxIndex = data.length - 1;
  }  

  //#region static check methods
  /**
   * check if the char is not a space char or a delimiter char
   * @param code char code
   * @returns 
   */
  private static isRegularChar(code: number): boolean {
    if (isNaN(code)) {
      return false;
    }
    return !this.delimiterChars.has(code) && !this.spaceChars.has(code);
  }

  /**
   * check if the char is a space char or a delimiter char
   * @param code char code
   * @returns 
   */
  private static isNotRegularChar(code: number): boolean {
    if (isNaN(code)) {
      return true;
    }
    return this.delimiterChars.has(code) || this.spaceChars.has(code);
  }

  private static isDigit(code: number): boolean {
    return this.digitChars.has(code);
  }

  private static isNewLineChar(code: number): boolean {
    return this.newLineChars.has(code);
  }

  private static isSpaceChar(code: number): boolean {
    return this.spaceChars.has(code);
  }

  private static isNotSpaceChar(code: number): boolean {
    return !this.spaceChars.has(code);
  }

  private static isDelimiterChar(code: number): boolean {
    return this.delimiterChars.has(code);
  }

  private static isNotDelimiterChar(code: number): boolean {
    return !this.delimiterChars.has(code);
  }
  //#endregion

  destroy() {
    
  }

  /**
   * get a new parser instance which inner data array is a subarray of the source parser data
   * @param start subarray start index
   * @param end subarray end index (chat at the end index is INCLUDED into the subarray)
   * @returns 
   */
  getSubParser(start: number, end?: number): DataParser {
    return new SyncDataParser(this.subCharCodes(start, end)); 
  }
  
  isOutside(index: number): boolean {
    return (index < 0 || index > this._maxIndex);
  }

  getValueTypeAt(start: number, skipEmpty = true): ValueType  {
    if (skipEmpty) {
      start = this.skipEmpty(start);
    }
    if (this.isOutside(start)) {
      return null;
    }

    const arr = this._data;
    const i = start;
    const charCode = arr[i];
    switch (charCode) {
      case codes.SLASH:
        if (SyncDataParser.isRegularChar(arr[i + 1])) {
          return valueTypes.NAME;
        } 
        return valueTypes.UNKNOWN;
      case codes.L_BRACKET:
        return valueTypes.ARRAY;
      case codes.L_PARENTHESE:
        return valueTypes.STRING_LITERAL;
      case codes.LESS:
        if (codes.LESS === arr[i + 1]) {          
          return valueTypes.DICTIONARY;
        }
        return valueTypes.STRING_HEX;
      case codes.PERCENT:
        return valueTypes.COMMENT;
      case codes.D_0:
      case codes.D_1:
      case codes.D_2:
      case codes.D_3:
      case codes.D_4:
      case codes.D_5:
      case codes.D_6:
      case codes.D_7:
      case codes.D_8:
      case codes.D_9:
        const nextDelimIndex = this.findDelimiterIndex(true, i + 1);
        if (nextDelimIndex !== -1) {
          const refEndIndex = this.findCharIndex(codes.R, false, nextDelimIndex - 1);
          if (refEndIndex !== -1 && refEndIndex > i && !SyncDataParser.isRegularChar(arr[refEndIndex + 1])) {
            return valueTypes.REF;
          }
        }
        return valueTypes.NUMBER;
      case codes.DOT:
      case codes.MINUS:
        if (SyncDataParser.isDigit(arr[i + 1])) {          
          return valueTypes.NUMBER;
        }
        return valueTypes.UNKNOWN;
      case codes.s:
        if (arr[i + 1] === codes.t
          && arr[i + 2] === codes.r
          && arr[i + 3] === codes.e
          && arr[i + 4] === codes.a
          && arr[i + 5] === codes.m) {
          return valueTypes.STREAM;
        }
        return valueTypes.UNKNOWN;
      case codes.t:
        if (arr[i + 1] === codes.r
          && arr[i + 2] === codes.u
          && arr[i + 3] === codes.e) {
          return valueTypes.BOOLEAN;
        }
        return valueTypes.UNKNOWN;
      case codes.f:
        if (arr[i + 1] === codes.a
          && arr[i + 2] === codes.l
          && arr[i + 3] === codes.s
          && arr[i + 4] === codes.e) {
          return valueTypes.BOOLEAN;
        }
        return valueTypes.UNKNOWN;
      default:
        return valueTypes.UNKNOWN;
    }
  } 

  //#region search methods

  findSubarrayIndex(sub: number[] | readonly number[], 
    options?: ParserOptions): ParserBounds { 

    const arr = this._data;
    if (!sub?.length) {
      return null;
    }

    const direction = options?.direction ?? true;
    const minIndex = Math.max(Math.min(options?.minIndex ?? 0, this._maxIndex), 0);
    const maxIndex = Math.max(Math.min(options?.maxIndex ?? this._maxIndex, this._maxIndex), 0);
    const allowOpened = !options?.closedOnly;

    let i = direction
      ? minIndex
      : maxIndex; 

    let j: number; 
    if (direction) { 
      outer_loop:
      for (i; i <= maxIndex; i++) {
        for (j = 0; j < sub.length; j++) {
          if (arr[i + j] !== sub[j]) {
            continue outer_loop;
          }
        }
        if (allowOpened || !SyncDataParser.isRegularChar(arr[i + j])) {
          return {start: i, end: i + j - 1};
        }
      }
    } else {
      const subMaxIndex = sub.length - 1;
      outer_loop:
      for (i; i >= minIndex; i--) {
        for (j = 0; j < sub.length; j++) {
          if (arr[i - j] !== sub[subMaxIndex - j]) {
            continue outer_loop;
          }
        }
        if (allowOpened || !SyncDataParser.isRegularChar(arr[i - j])) {
          return {start: i - j + 1, end: i};
        }
      }
    }

    return null;
  }

  findCharIndex(charCode: number, direction = true, 
    start?: number): number {    

    const arr = this._data;
    let i = isNaN(start)
      ? direction
        ? 0
        : this._maxIndex
      : start; 

    if (direction) {        
      for (i; i <= this._maxIndex; i++) {
        if (arr[i] === charCode) {
          return i;
        }
      }    
    } else {        
      for (i; i >= 0; i--) {
        if (arr[i] === charCode) {
          return i;
        }
      }
    }

    return -1; 
  }

  findNewLineIndex(direction = true, 
    start?: number): number {

    let lineBreakIndex: number;     

    const arr = this._data;
    let i = isNaN(start)
      ? direction
        ? 0
        : this._maxIndex
      : start; 
      
    if (direction) {        
      for (i; i <= this._maxIndex; i++) {
        if (SyncDataParser.isNewLineChar(arr[i])) {
          lineBreakIndex = i;
          break;
        }
      }    
    } else {        
      for (i; i >= 0; i--) {
        if (SyncDataParser.isNewLineChar(arr[i])) {
          lineBreakIndex = i;
          break;
        }
      }
    }

    if (lineBreakIndex === undefined) {
      return -1;
    }

    if (direction) {  
      if (this._data[lineBreakIndex] === codes.CARRIAGE_RETURN 
        && this._data[lineBreakIndex + 1] === codes.LINE_FEED) {
        lineBreakIndex++;
      }  
      return Math.min(lineBreakIndex + 1, this._maxIndex);
    } else {        
      if (this._data[lineBreakIndex] === codes.LINE_FEED 
        && this._data[lineBreakIndex - 1] === codes.CARRIAGE_RETURN) {
        lineBreakIndex--;
      }  
      return Math.max(lineBreakIndex - 1, 0);
    }
  }
  
  findSpaceIndex(direction = true, 
    start?: number): number {

    const arr = this._data;
    let i = isNaN(start)
      ? direction
        ? 0
        : this._maxIndex
      : start; 
      
    if (direction) {        
      for (i; i <= this._maxIndex; i++) {
        if (SyncDataParser.isSpaceChar(arr[i])) {
          return i;
        }
      }    
    } else {        
      for (i; i >= 0; i--) {
        if (SyncDataParser.isSpaceChar(arr[i])) {
          return i;
        }
      }
    }
    
    return -1;
  }

  findNonSpaceIndex(direction = true, 
    start?: number): number {

    const arr = this._data;
    let i = isNaN(start)
      ? direction
        ? 0
        : this._maxIndex
      : start; 
      
    if (direction) {        
      for (i; i <= this._maxIndex; i++) {
        if (SyncDataParser.isNotSpaceChar(arr[i])) {
          return i;
        }
      }    
    } else {        
      for (i; i >= 0; i--) {
        if (SyncDataParser.isNotSpaceChar(arr[i])) {
          return i;
        }
      }
    }
    
    return -1;
  }
  
  findDelimiterIndex(direction = true, 
    start?: number): number {

    const arr = this._data;
    let i = isNaN(start)
      ? direction
        ? 0
        : this._maxIndex
      : start; 
      
    if (direction) {        
      for (i; i <= this._maxIndex; i++) {
        if (SyncDataParser.isDelimiterChar(arr[i])) {
          return i;
        }
      }    
    } else {        
      for (i; i >= 0; i--) {
        if (SyncDataParser.isDelimiterChar(arr[i])) {
          return i;
        }
      }
    }
    
    return -1; 
  }
  
  findNonDelimiterIndex(direction = true, 
    start?: number): number {
      
    const arr = this._data;
    let i = isNaN(start)
      ? direction
        ? 0
        : this._maxIndex
      : start; 
      
    if (direction) {        
      for (i; i <= this._maxIndex; i++) {
        if (SyncDataParser.isNotDelimiterChar(arr[i])) {
          return i;
        }
      }    
    } else {        
      for (i; i >= 0; i--) {
        if (SyncDataParser.isNotDelimiterChar(arr[i])) {
          return i;
        }
      }
    }
    
    return -1;
  }

  findRegularIndex(direction = true, 
    start?: number): number {

    const arr = this._data;
    let i = isNaN(start)
      ? direction
        ? 0
        : this._maxIndex
      : start; 
      
    if (direction) {        
      for (i; i <= this._maxIndex; i++) {
        if (SyncDataParser.isRegularChar(arr[i])) {
          return i;
        }
      }    
    } else {        
      for (i; i >= 0; i--) {
        if (SyncDataParser.isRegularChar(arr[i])) {
          return i;
        }
      }
    }
    
    return -1;
  }

  findIrregularIndex(direction = true, 
    start?: number): number {
    
    const arr = this._data;
    let i = isNaN(start)
      ? direction
        ? 0
        : this._maxIndex
      : start; 
      
    if (direction) {        
      for (i; i <= this._maxIndex; i++) {
        if (SyncDataParser.isNotRegularChar(arr[i])) {
          return i;
        }
      }    
    } else {        
      for (i; i >= 0; i--) {
        if (SyncDataParser.isNotRegularChar(arr[i])) {
          return i;
        }
      }
    }
    
    return -1;
  }

  //#endregion

  //#region get bounds methods  
  
  getIndirectObjectBoundsAt(start: number, skipEmpty = true): ParserBounds {   
    if (skipEmpty) {
      start = this.skipEmpty(start);
    }
    if (this.isOutside(start)) {
      return null;
    }    

    const objStartIndex = this.findSubarrayIndex(keywordCodes.OBJ, 
      {minIndex: start, closedOnly: true});
    if (!objStartIndex) {
      return null;
    }      

    let contentStart = this.findNonSpaceIndex(true, objStartIndex.end + 1);
    if (contentStart === -1){
      return null;
    }    
    const objEndIndex = this.findSubarrayIndex(keywordCodes.OBJ_END, 
      {minIndex: contentStart, closedOnly: true});
    if (!objEndIndex) {
      return null;
    }
    let contentEnd = this.findNonSpaceIndex(false, objEndIndex.start - 1);

    if (this.getCharCode(contentStart) === codes.LESS
      && this.getCharCode(contentStart + 1) === codes.LESS
      && this.getCharCode(contentEnd - 1) === codes.GREATER
      && this.getCharCode(contentEnd) === codes.GREATER) {
      // object is dict. exclude bounds from content
      contentStart += 2;
      contentEnd -=2;
    }

    return {
      start: objStartIndex.start, 
      end: objEndIndex.end,
      contentStart,
      contentEnd,
    };
  } 
  
  getXrefTableBoundsAt(start: number, skipEmpty = true): ParserBounds {   
    if (skipEmpty) {
      start = this.skipEmpty(start);
    }
    if (this.isOutside(start) || this._data[start] !== codes.x) {
      return null;
    }

    const xrefStart = this.findSubarrayIndex(keywordCodes.XREF_TABLE, 
      {minIndex: start});
    if (!xrefStart) {
      return null;
    }     
    const contentStart = this.findNonSpaceIndex(true, xrefStart.end + 1);
    if (contentStart === -1){
      return null;
    }   
    const xrefEnd = this.findSubarrayIndex(keywordCodes.TRAILER, 
      {minIndex: xrefStart.end + 1});
    if (!xrefEnd) {
      return null;
    } 
    const contentEnd = this.findNonSpaceIndex(false, xrefEnd.start - 1);

    if (contentEnd < contentStart) {
      // should be only possible in an empty xref, which is not allowed
      return null;
    }

    return {
      start: xrefStart.start, 
      end: xrefEnd.end,
      contentStart,
      contentEnd,
    };
  }

  getDictBoundsAt(start: number, skipEmpty = true): ParserBounds {   
    if (skipEmpty) {
      start = this.skipEmpty(start);
    }
    if (this.isOutside(start) 
      || this._data[start] !== codes.LESS
      || this._data[start + 1] !== codes.LESS) {
      return null;
    }
     
    const contentStart = this.findNonSpaceIndex(true, start + 2);
    if (contentStart === -1){
      return null;
    }  
    
    let dictOpened = 1;
    let dictBound = true;
    let literalOpened = 0;
    let i = contentStart;    
    let code: number;
    let prevCode: number;
    while (dictOpened) {
      prevCode = code;
      code = this._data[i++];

      if (code === codes.L_PARENTHESE
        && (!literalOpened || prevCode !== codes.BACKSLASH)) {
        // increase string literal nesting
        literalOpened++;
      }

      if (code === codes.R_PARENTHESE
        && (literalOpened && prevCode !== codes.BACKSLASH)) {
        // decrease string literal nesting
        literalOpened--;
      }

      if (literalOpened) {
        // ignore 'less' and 'greater' signs while being inside a literal
        continue;
      }

      if (!dictBound) {
        if (code === codes.LESS && code === prevCode) {
          dictOpened++;
          dictBound = true;
        } else if (code === codes.GREATER && code === prevCode) {
          dictOpened--;
          dictBound = true;
        }
      } else {        
        dictBound = false;
      }
    }
    const end = i - 1;
 
    const contentEnd = this.findNonSpaceIndex(false, end - 2);
    if (contentEnd < contentStart) {
      // should be possible only in an empty dict
      return {
        start, 
        end,
      };
    }

    return {
      start, 
      end,
      contentStart,
      contentEnd,
    };
  }
  
  getArrayBoundsAt(start: number, skipEmpty = true): ParserBounds {
    if (skipEmpty) {
      start = this.skipEmpty(start);
    }
    if (this.isOutside(start) || this._data[start] !== codes.L_BRACKET) {
      return null;
    }

    let arraysOpened = 1;
    let i = start + 1;    
    let code: number;
    while (arraysOpened) {
      code = this._data[i++];
      if (code === codes.L_BRACKET) {
        arraysOpened++;
      } else if (code === codes.R_BRACKET) {
        arraysOpened--;
      }
    }
    const arrayEnd = i - 1;
    if (arrayEnd - start < 1) {
      return null;
    }

    return {start, end: arrayEnd};
  }
      
  getHexBounds(start: number, skipEmpty = true): ParserBounds  {   
    if (skipEmpty) {
      start = this.skipEmpty(start);
    }
    if (this.isOutside(start) || this.getCharCode(start) !== codes.LESS) {
      return null;
    }

    const end = this.findCharIndex(codes.GREATER, true, start + 1);
    if (end === -1) {
      return null;
    }

    return {start, end};
  }  

  getLiteralBounds(start: number, skipEmpty = true): ParserBounds  {       
    if (skipEmpty) {
      start = this.skipEmpty(start);
    }
    if (this.isOutside(start) || this.getCharCode(start) !== codes.L_PARENTHESE) {
      return null;
    }

    let i = start;
    let code: number;
    let escaped = false;
    let opened = 0;

    while (opened || code !== codes.R_PARENTHESE || escaped) {
      if (i > this._maxIndex) {
        return null;
      }

      code = this.getCharCode(i++);

      if (!escaped) {
        if (code === codes.L_PARENTHESE) {
          opened += 1;
        } else if (opened && code === codes.R_PARENTHESE) {
          opened -= 1;
        }
      }
      
      if (!escaped && code === codes.BACKSLASH) {
        escaped = true;
      } else {
        escaped = false;
      }
    }

    return {start, end: i - 1};
  }

  //#endregion

  //#region parse methods  

  parseNumberAt(start: number, 
    float = false, skipEmpty = true): ParserResult<number>  {
    if (skipEmpty) {
      start = this.skipEmpty(start);
    }
    if (this.isOutside(start) || !SyncDataParser.isRegularChar(this._data[start])) {
      return null;
    }

    let i = start;
    let numberStr = "";
    let value = this._data[i];
    if (value === codes.MINUS) {
      numberStr += "-";
      value = this._data[++i];
    } else if (value === codes.DOT) {
      numberStr += "0.";
      value = this._data[++i];
    }
    while (SyncDataParser.isDigit(value)
      || (float && value === codes.DOT)) {
      numberStr += String.fromCharCode(value);
      value = this._data[++i];
    };

    return numberStr 
      ? {value: +numberStr, start, end: i - 1}
      : null;
  }
  
  parseNameAt(start: number, 
    includeSlash = true, skipEmpty = true): ParserResult<string>  {
    if (skipEmpty) {
      start = this.skipEmpty(start);
    }
    if (this.isOutside(start) || this._data[start] !== codes.SLASH) {
      return null;
    }

    let i = start + 1;
    let result = includeSlash
      ? "/"
      : "";
    let value = this._data[i];
    while (SyncDataParser.isRegularChar(value)) {
      result += String.fromCharCode(value);
      value = this._data[++i];
    };

    return result.length > 1 
      ? {value: result, start, end: i - 1}
      : null;
  } 
  
  parseStringAt(start: number, skipEmpty = true): ParserResult<string>  {
    if (skipEmpty) {
      start = this.skipEmpty(start);
    }
    if (this.isOutside(start)) {
      return null;
    }

    let i = start;
    let result = "";
    let value = this._data[i];
    while (SyncDataParser.isRegularChar(value)) {
      result += String.fromCharCode(value);
      value = this._data[++i];
    };

    return result.length !== 0 
      ? {value: result, start, end: i - 1}
      : null;
  } 
  
  parseBoolAt(start: number, skipEmpty = true): ParserResult<boolean>  {
    if (skipEmpty) {
      start = this.skipEmpty(start);
    }    

    if (this.isOutside(start)) {
      return null;
    }

    const nearestDelimiter = this.findDelimiterIndex(true, start);

    const isTrue = this.findSubarrayIndex(keywordCodes.TRUE, {
      minIndex: start, 
      maxIndex: nearestDelimiter === -1 ? this._maxIndex : nearestDelimiter,
    });
    if (isTrue) {
      return {value: true, start, end: isTrue.end};
    }    
    
    const isFalse = this.findSubarrayIndex(keywordCodes.FALSE, {
      minIndex: start,      
      maxIndex: nearestDelimiter === -1 ? this._maxIndex : nearestDelimiter,
    });
    if (isFalse) {
      return {value: false, start, end: isFalse.end};
    }

    return null;
  } 
  
  parseNumberArrayAt(start: number, float = true, 
    skipEmpty = true): ParserResult<number[]>  {
    const arrayBounds = this.getArrayBoundsAt(start, skipEmpty);
    if (!arrayBounds) {
      return null;
    }

    const numbers: number[] = [];
    let current: ParserResult<number>;
    let i = arrayBounds.start + 1;
    while(i < arrayBounds.end) {
      current = this.parseNumberAt(i, float, true);
      if (!current) {
        break;
      }
      numbers.push(current.value);
      i = current.end + 1;
    }

    return {value: numbers, start: arrayBounds.start, end: arrayBounds.end};
  }  
  
  parseNameArrayAt(start: number, includeSlash = true, 
    skipEmpty = true): ParserResult<string[]>  {
    const arrayBounds = this.getArrayBoundsAt(start, skipEmpty);
    if (!arrayBounds) {
      return null;
    }

    const names: string[] = [];
    let current: ParserResult<string>;
    let i = arrayBounds.start + 1;
    while(i < arrayBounds.end) {
      current = this.parseNameAt(i, includeSlash, true);
      if (!current) {
        break;
      }
      names.push(current.value);
      i = current.end + 1;
    }

    return {value: names, start: arrayBounds.start, end: arrayBounds.end};
  }  
  
  parseDictType(bounds: ParserBounds): string  {
    return this.parseDictPropertyByName(keywordCodes.TYPE, bounds);   
  } 
  
  parseDictSubtype(bounds: ParserBounds): string {
    return this.parseDictPropertyByName(keywordCodes.SUBTYPE, bounds);   
  } 
  
  parseDictPropertyByName(propName: readonly number[] | number[], bounds: ParserBounds): string {
    const arr = this._data;
    if (!propName?.length) {
      return null;
    }

    const minIndex = Math.max(Math.min(bounds.start ?? 0, this._maxIndex), 0);
    const maxIndex = Math.max(Math.min(bounds.end ?? this._maxIndex, this._maxIndex), 0);

    let propNameBounds: ParserBounds;
    let i = minIndex;
    let j: number;
    let code: number;
    let prevCode: number;
    let dictOpened = 0;
    let dictBound = true;
    let literalOpened = 0;
    outer_loop:
    for (i; i <= maxIndex; i++) {
      prevCode = code;
      code = arr[i];
      
      // check if literal opens
      if (code === codes.L_PARENTHESE
        && (!literalOpened || prevCode !== codes.BACKSLASH)) {
        // increase string literal nesting
        literalOpened++;
      }

      // check if literal closes
      if (code === codes.R_PARENTHESE
        && (literalOpened && prevCode !== codes.BACKSLASH)) {
        // decrease string literal nesting
        literalOpened--;
      }

      if (literalOpened) {
        // ignore all bytes while being inside a literal
        continue;
      }

      // check if dict opens or closes
      if (!dictBound) {
        if (code === codes.LESS && code === prevCode) {
          dictOpened++;
          dictBound = true;
        } else if (code === codes.GREATER && code === prevCode) {
          dictOpened--;
          dictBound = true;
        }
      } else {        
        dictBound = false;
      }

      // compare next j values to the corresponding values of the sought name
      for (j = 0; j < propName.length; j++) {
        if (arr[i + j] !== propName[j]) {
          continue outer_loop;
        }
      }

      if (dictOpened !== 1) {
        // the found property name is not inside the topmost dict
        continue;
      }

      // check if name is closed
      if (!SyncDataParser.isRegularChar(arr[i + j])) {
        propNameBounds = {start: i, end: i + j - 1};
        break;
      }
    }
    
    if (!propNameBounds) {
      // the property name is not found
      return null;
    }

    // parse the property value
    const type = this.parseNameAt(propNameBounds.end + 1);
    if (!type) {
      return null;
    }

    return type.value;     
  } 
  //#endregion
  
  //#region skip methods

  skipEmpty(start: number): number {
    let index = this.findNonSpaceIndex(true, start);
    if (index === -1) {
      return -1;
    }
    if (this._data[index] === codes.PERCENT) {
      // it's a comment. skip it
      const afterComment = this.findNewLineIndex(true, index + 1);
      if (afterComment === -1) {
        return -1;
      }
      index = this.findNonSpaceIndex(true, afterComment);
    }
    return index;
  }

  skipToNextName(start: number, max: number): number {
    start ||= 0;
    max = max 
      ? Math.min(max, this._maxIndex)
      : 0;
    if (max < start) {
      return -1;
    }

    let i = start;
    while (i <= max) {      
      const value = this.getValueTypeAt(i, true);
      if (value) {
        let skipValueBounds: ParserBounds;
        switch (value) {
          case valueTypes.DICTIONARY:
            skipValueBounds = this.getDictBoundsAt(i, false);
            break;
          case valueTypes.ARRAY:
            skipValueBounds = this.getArrayBoundsAt(i, false);
            break;
          case valueTypes.STRING_LITERAL:            
            skipValueBounds = this.getLiteralBounds(i, false);
            break; 
          case valueTypes.STRING_HEX: 
            skipValueBounds = this.getHexBounds(i, false);
            break; 
          case valueTypes.NUMBER:
            const numberParseResult = this.parseNumberAt(i, true, false);
            if (numberParseResult) {
              skipValueBounds = numberParseResult;
            }
            break; 
          case valueTypes.BOOLEAN:
            const boolParseResult = this.parseBoolAt(i, false);
            if (boolParseResult) {
              skipValueBounds = boolParseResult;
            }
            break;
          case valueTypes.COMMENT:
            // TODO: Add skip comment
            break;
          case valueTypes.NAME:
            return i;
          default:
            i++;
            continue;
        }   
        if (skipValueBounds) {
          i = skipValueBounds.end + 1;
          skipValueBounds = null;     
          continue;
        }
      }
      i++;
    }
    return -1;
  }

  //#endregion

  //#region get chars/codes methods

  getCharCode(index: number): number {    
    return this._data[index];
  }

  getChar(index: number): string {    
    const code = this._data[index];
    if (!isNaN(code)) {
      return String.fromCharCode(code);
    }
    return null;
  }

  sliceCharCodes(start: number, end?: number): Uint8Array {
    return this._data.slice(start, (end || start) + 1);
  }

  sliceChars(start: number, end?: number): string {
    return String.fromCharCode(...this._data.slice(start, (end || start) + 1));
  }
  
  private subCharCodes(start: number, end?: number): Uint8Array {
    return this._data.subarray(start, (end || start) + 1);
  }
  
  //#endregion
}
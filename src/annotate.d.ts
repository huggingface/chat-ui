declare module 'dom-anchor-text-quote' {
    interface TextQuoteSelector {
      exact: string;
      prefix?: string;
      suffix?: string;
    }
  
    interface TextPositionSelector {
      start: number;
      end: number;
    }
  
    interface ToTextPositionOptions {
      hint?: number;
    }
  
    export function fromRange(root: Node, range: Range): TextQuoteSelector;
  
    export function fromTextPosition(root: Node, selector: TextPositionSelector): TextQuoteSelector;
  
    export function toRange(root: Node, selector: TextQuoteSelector, options?: ToTextPositionOptions): Range | null;
  
    export function toTextPosition(root: Node, selector: TextQuoteSelector, options?: ToTextPositionOptions): TextPositionSelector | null;
  }

  declare module 'dom-anchor-text-position' {
    interface TextPositionSelector {
      start: number;
      end: number;
    }
  
    export function fromRange(root: Node, range: Range): TextPositionSelector;
  
    export function toRange(root: Node, selector: TextPositionSelector): Range;
  }

  declare module 'wrap-range-text' {
    export interface WrapperObject {
      nodes: Node[];
      unwrap: () => void;
    }
  
    function wrapRangeText(wrapperEl?: HTMLElement | string, range?: Range): WrapperObject;
  
    export = wrapRangeText;
  }
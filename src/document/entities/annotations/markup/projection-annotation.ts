import { annotationTypes } from "../../../const";
import { CryptInfo } from "../../../common-interfaces";
import { MarkupAnnotation } from "./markup-annotation";
import { SvgWithBox } from "../../../../common";

export class ProjectionAnnotation extends MarkupAnnotation {
  // TODO: implement
  
  constructor() {
    super(annotationTypes.PROJECTION);
  }
  
  toArray(cryptInfo?: CryptInfo): Uint8Array {
    // TODO: implement
    return new Uint8Array();
  }
  
  render(): SvgWithBox {
    const streamRenderResult = super.render();
    if (streamRenderResult) {
      return streamRenderResult;
    }

    // TODO: implement individual render methods
    return null;
  }
}

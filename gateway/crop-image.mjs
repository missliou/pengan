import {createHash} from 'node:crypto';
export const MAX_IMAGE_BYTES=2*1024*1024;
export function validateImageInput(input){
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!['prompt','mimeType','imageBase64'].includes(key)))throw new Error('invalid_image_input');
  if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>1000)throw new Error('invalid_prompt');
  if(!['image/jpeg','image/png'].includes(input.mimeType))throw new Error('unsupported_image_type');
  const encoded=input.imageBase64;
  if(typeof encoded!=='string'||encoded.length>4*Math.ceil(MAX_IMAGE_BYTES/3))throw new Error('image_too_large');
  if(!encoded||encoded.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('invalid_image_base64');
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length>MAX_IMAGE_BYTES)throw new Error('image_too_large');
  if(bytes.length<32||bytes.toString('base64')!==encoded)throw new Error('invalid_image_base64');
  const valid=input.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!valid)throw new Error('image_signature_mismatch');
  return {prompt:input.prompt.trim(),mimeType:input.mimeType,imageBase64:encoded,imageSha256:createHash('sha256').update(bytes).digest('hex')};
}

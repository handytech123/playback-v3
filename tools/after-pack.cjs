module.exports=async context=>{
 const {verifyPackage}=await import('./verify-release-package.mjs');
 await verifyPackage(context.appOutDir);
};

const { validateSelection } = require('../services/InsuranceCatalog');

class AuthController {constructor(service){this.service=service;}
 register=async(req,res)=>{try{await this.service.register(req.body.email,req.body.password);res.status(201).json({message:'Account created successfully. Please log in.'});}catch(e){res.status(400).json({message:e.message});}};
 login=async(req,res)=>{try{const u=await this.service.login(req.body.email,req.body.password);req.session.regenerate(err=>{if(err)return res.status(500).json({message:'Session error'});req.session.userId=u.id;res.json({message:'Logged in',accessType:'Login',email:u.email,preferences:u.preferences});});}catch(e){res.status(401).json({message:e.message});}};
 guest=(req,res)=>{req.session.regenerate(err=>{if(err)return res.status(500).json({message:'Session error'});req.session.accessType='Guest';req.session.intake={};res.json({message:'Guest session started',accessType:'Guest'});});};
 me=(req,res)=>{const u=req.session.userId&&this.service.repo.findById(req.session.userId);res.json({accessType:u?'Login':req.session.accessType||'None',email:u?.email||null,preferences:u?.preferences||{},intake:req.session.intake||{}});};
 save=(req,res)=>{if(!req.session.userId)return res.status(401).json({message:'Log in to save preferences.'});const {zip='',insurerId='',planId=''}=req.body||{};const selection=validateSelection(String(insurerId).trim(),String(planId).trim());if(!selection.valid)return res.status(400).json({message:selection.message});res.json({preferences:this.service.savePreferences(req.session.userId,{zip:String(zip).trim(),insurerId:String(insurerId).trim(),planId:String(planId).trim()})});};
 logout=(req,res)=>req.session.destroy(err=>err?res.status(500).json({message:'Could not end session'}):res.clearCookie('connect.sid').json({message:'Session ended'}));
}module.exports=AuthController;

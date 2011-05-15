/**
 * Job scheduler - enables create, update, delete and execution of jobs on
 * cron schedules.
 */

var calipso = require("lib/calipso"), cron = require('./scheduler.cron');

exports = module.exports = {init: init, route: route, reload: reload, disable: disable};

function route(req,res,module,app,next) {

      /**
       * Menu items
       */
      res.menu.admin.primary.push({name:'Scheduler',url:'/scheduler',regexp:/scheduler/});

      /**
       * Routes
       */
      module.router.route(req,res,next);

};

function init(module,app,next) {

  calipso.lib.step(
      function defineRoutes() {
        module.router.addRoute('GET /scheduler',schedulerAdmin,{template:'admin',block:'admin',admin:true},this.parallel());
        module.router.addRoute('POST /scheduler',createJob,{admin:true},this.parallel());
        module.router.addRoute('GET /scheduler/new',createJobForm,{admin:true,block:'admin'},this.parallel());
        module.router.addRoute('GET /scheduler/switch/:onoff.:format?',enableScheduler,{admin:true},this.parallel());
        module.router.addRoute('GET /scheduler/switch/:onoff/:jobName.:format?',enableScheduler,{admin:true},this.parallel());
        module.router.addRoute('GET /scheduler/show/:jobName',showJob,{admin:true,template:'show',block:'admin'},this.parallel());
        module.router.addRoute('GET /scheduler/edit/:jobName',editJobForm,{admin:true,block:'content'},this.parallel());
        module.router.addRoute('GET /scheduler/delete/:jobName',deleteJob,{admin:true},this.parallel());
        module.router.addRoute('POST /scheduler/:jobName',updateJob,{admin:true},this.parallel());
      },
      function done() {

        // Ensure we have the job schema defined
        var ScheduledJob = new calipso.lib.mongoose.Schema({
          name:{type: String, required: true, unique: true},
          cronTime:{type: String, default:'* * * * * *',required: true},
          enabled:{type: Boolean, default:false, required: true},
          module:{type: String, default:'', required: true},
          method:{type: String, default:'', required: true},
          args:{type: String, default:'', required: false}
        });
        calipso.lib.mongoose.model('ScheduledJob', ScheduledJob);

        // Load the exposed job functions into a job function array
        // This scans all the other modules
        calipso.data.jobFunctions = [];
        for(var module in calipso.modules) {
          for(var job in calipso.modules[module].fn.jobs) {
              calipso.data.jobFunctions.push(module + "." + job);
          }
        }

        // Load the current jobs into Calipso
        loadJobs(next);

      }
  );

};

function loadJobs(next) {

  var ScheduledJob = calipso.lib.mongoose.model('ScheduledJob');

  // Check to see if we already have any jobs.
  // Create a holder for our jobs - DOES THIS STOP EVERYTHING ELSE??!
  calipso.jobs = {};

  ScheduledJob.find({}, function(err, jobs) {

        jobs.forEach(function(job) {
          // '* * * * * *'
          if(calipso.modules[job.module] && calipso.modules[job.module].fn.jobs[job.method]) {


            var options = {
                jobName: job.name,
                cronTime: job.cronTime,
                enabled: job.enabled,
                module: job.module,
                method: job.method,
                fn: calipso.modules[job.module].fn.jobs[job.method],
                args: job.args
            }

            calipso.jobs[job.name] = new cron.CronJob(options);
          } else {

            var options = {
                jobName: job.name,
                cronTime: job.cronTime,
                enabled: job.enabled,
                module: job.module,
                method: job.method,
                fn: function() { calipso.error("Invalid function " + job.module
                                + "." + job.method + " for job: " + job.name)},
                args: job.args
            }
            calipso.jobs[job.name] = new cron.CronJob(options);
            calipso.jobs[job.name].invalid = true;
          }

        });

        next();
  });

}

/**
 * Quick API to turn jobs on and off.
 *
 * @param req
 * @param res
 * @param next
 * @param template
 */
function enableScheduler(req,res,template,block,next) {

    // TODO : THIS DOESN@T ACTUALLY UPDATE THE DATABASE AND SO IS NOT STORED!

    var jobName = req.moduleParams.jobName;
    var format = req.moduleParams.format;

    if(jobName) {

      if(!calipso.jobs[jobName]) {

        if(format === 'json') {
          res.send({status:'error',msg:'Could not locate job: ' + jobName});
        } else {
          req.flash('error','Could not locate job: ' + jobName);
          res.redirect("/scheduler");
        }
        return;
      }

      if(req.moduleParams.onoff === 'on') {
        calipso.jobs[jobName].enable();
      } else {
        calipso.jobs[jobName].disable();
      }

    } else {

      for(var job in calipso.jobs) {
        if(req.moduleParams.onoff === 'on') {
            calipso.jobs[job].enable();
        } else {
            calipso.jobs[job].disable();
        }
      }

    }

    if(format === 'json') {
      res.send({status:'ok'});
    } else {
      res.redirect("/scheduler");
    }


};

function schedulerAdmin(req,res,template,block,next) {


    res.menu.admin.secondary.push({name:'New Job',parentUrl:'/scheduler',url:'/scheduler/new'});
    res.menu.admin.secondary.push({name:'Enable All',parentUrl:'/scheduler',url:'/scheduler/switch/on'});
    res.menu.admin.secondary.push({name:'Disable All',parentUrl:'/scheduler',url:'/scheduler/switch/off'});


    var ScheduledJob = calipso.lib.mongoose.model('ScheduledJob');

    // Render json to blocks
    var item = {id:"NA",type:'content',meta:{jobs:calipso.jobs}};
    calipso.theme.renderItem(req,res,template,block,{item:item});
    next();

};

/**
 * The form used to create/update jobs
 */

var jobCronTimeInstruction = "Examples:<br/>"
                              +"00 * * * * * : When seconds are zero exactly.<br/>"
                              +"*/5 * * * * * : Every five seconds.<br/>"
                              +"10-20 * * * * * : Every second from 10 through 20.<br/>"
                              +"00 00 02 * * * : 2AM every day.<br/>"
                              +"23 12 02 * jan mon-fri : @ 2:12:23 Monday to Friday in January.<br/>";


var jobForm = {id:'job-form',title:'',type:'form',method:'POST',action:'/scheduler',fields:[
                  {label:'Name',name:'job[name]',instruct:'Enter a unique name for the job',type:'text'},
                  {label:'CRON Time',name:'job[cronTime]',instruct:jobCronTimeInstruction,type:'cronTime'},
                  {label:'Enabled',name:'job[enabled]',type:'select',instruct:'Enable or disable the job',options:["Yes","No"]},
                  {label:'Job Function',name:'job[moduleMethod]',instruct:'Select the job function to run as per this schedule',type:'select',options:function() { return calipso.data.jobFunctions }},
                  {label:'Arguments',name:'job[args]',instruct:'Enter the arguments (as per the job function)',type:'textarea'}
               ],
               buttons:[
                        {name:'submit',type:'submit',value:'Save Job'}
               ]}

function createJobForm(req,res,template,block,next) {

  res.menu.admin.secondary.push({name:'New Job',parentUrl:'/scheduler',url:'/scheduler/new'});

  jobForm.title = "Create New Job";
  jobForm.action = "/scheduler";

  var values = {
      job: {
        enabled: "No",
        cronTime: "* * * * * *"
      }
  };

  calipso.form.render(jobForm,values,function(form) {
    calipso.theme.renderItem(req,res,form,block);
    next();
  });

}

function createJob(req,res,template,block,next) {


  calipso.form.process(req,function(form) {

    if(form) {

      var ScheduledJob = calipso.lib.mongoose.model('ScheduledJob');

      var job = new ScheduledJob(processForm(form.job));

      job.save(function(err) {
        if(err) {
          req.flash('error','Could not save content: ' + err.message);
          if(res.statusCode != 302) {
            res.redirect('back');
          }
        } else {

          if(calipso.modules[job.module] && calipso.modules[job.module].fn.jobs[job.method]) {

            var options = {
                jobName: job.name,
                cronTime: job.cronTime,
                enabled: job.enabled,
                module: job.module,
                method: job.method,
                fn: calipso.modules[job.module].fn.jobs[job.method],
                args: job.args
            }

            calipso.jobs[job.name] = new cron.CronJob(options);

          } else {
            req.flash('error',"Module: " + job.module + ', Method: ' + job.method + " does not exist, job not initialised.");
          }

          res.redirect('/scheduler');
        }
        // If not already redirecting, then redirect
        next();
      });
    }
  });
}

function processForm(formObject) {

  //Name - strip out any spaces
  formObject.name = formObject.name.replace(/\s/,"");
  formObject.args = formObject.args;

  // Enabled
  if(formObject.enabled === 'Yes') {
    formObject.enabled = true;
  } else {
    formObject.enabled = false;
  }

  // Module method splitter
  formObject.module = formObject.moduleMethod.split(".")[0];
  formObject.method = formObject.moduleMethod.split(".")[1];
  delete formObject.moduleMethod;

  // Cron time builder
  formObject.cronTime = formObject.cronTime0 + " "
                 + formObject.cronTime1 + " "
                 + formObject.cronTime2 + " "
                 + formObject.cronTime3 + " "
                 + formObject.cronTime4 + " "
                 + formObject.cronTime5

  delete formObject.cronTime0;
  delete formObject.cronTime1;
  delete formObject.cronTime2;
  delete formObject.cronTime3;
  delete formObject.cronTime4;
  delete formObject.cronTime5;

  return formObject;

}

function editJobForm(req,res,template,block,next) {

  var ScheduledJob = calipso.lib.mongoose.model('ScheduledJob');

  var jobName = req.moduleParams.jobName;
  var item;

  res.menu.admin.secondary.push({name:'New Job',parentUrl:'/scheduler',url:'/scheduler/new'});
  res.menu.admin.secondary.push({name:'Edit Job',parentUrl:'/scheduler',url:'/scheduler/edit/' + jobName});

  ScheduledJob.findOne({name:jobName}, function(err, job) {

    if(err || job === null) {

      res.statusCode = 404;
      next();

    } else {

      // Setup form
      jobForm.action = '/scheduler/' + job.name;
      jobForm.title = "Job: " + job.name;

      // Assign value object
      var values = {
          job: job
      };

      // Concatenate method
      values.job.moduleMethod = job.module + "." + job.method;
      values.job.enabled = job.enabled ? "Yes" : "No";

      // Render form
      calipso.form.render(jobForm,values,function(form) {
        calipso.theme.renderItem(req,res,form,block);
        next();
      });

    }

  });

}

function updateJob(req,res,template,block,next) {

 calipso.form.process(req,function(form) {

    if(form) {

      var ScheduledJob = calipso.lib.mongoose.model('ScheduledJob');
      var jobName = req.moduleParams.jobName;

      ScheduledJob.findOne({name:jobName}, function(err, job) {

        if(err) {
          calipso.error(err);
        }

        if (job) {

          var formData = processForm(form.job);

          job.name = formData.name;
          job.enabled = formData.enabled;
          job.cronTime = formData.cronTime;
          job.args = formData.args;
          job.module = formData.module;
          job.method = formData.method;

          job.save(function(err) {

              if(err) {

                req.flash('error','Could not update job: ' + err.message);
                if(res.statusCode != 302) {  // Don't redirect if we already are, multiple errors
                  res.redirect('/scheduler/edit/' + job.name);
                }

              } else {

                if(jobName != job.name) {
                  calipso.jobs[job.name] = calipso.jobs[jobName];   // Copy it
                  delete calipso.jobs[jobName];                  // 'Delete' it - GC will get it later ???
                }

                if(calipso.modules[job.module] && calipso.modules[job.module].fn.jobs[job.method]) {

                  var options = {
                      jobName: job.name,
                      cronTime: job.cronTime,
                      enabled: job.enabled,
                      module: job.module,
                      method: job.method,
                      fn: calipso.modules[job.module].fn.jobs[job.method],
                      args: job.args
                  }

                  calipso.jobs[job.name].configure(options);

                } else {
                  req.flash('error',"Module: " + job.module + ', Method: ' + job.method + " does not exist, job modified but not initialised.");
                }

                res.redirect('/scheduler/show/' + job.name);

              }
              next();
            });

        } else {
          req.flash('error','Could not locate job!');
          res.redirect('/scheduler');
          next();
        }
      });
    }
 });

}


function showJob(req,res,template,block,next,err) {

  var ScheduledJob = calipso.lib.mongoose.model('ScheduledJob');

  var jobName = req.moduleParams.jobName;
  var item;

  res.menu.admin.secondary.push({name:'New Job',parentUrl:'/scheduler',url:'/scheduler/new'});
  res.menu.admin.secondary.push({name:'Edit Job',parentUrl:'/scheduler',url:'/scheduler/edit/' + jobName});
  res.menu.admin.secondary.push({name:'Delete Job',parentUrl:'/scheduler',url:'/scheduler/delete/' + jobName});

  ScheduledJob.findOne({name:jobName}, function(err, job) {

    if(err || job === null) {
      res.redirect("/scheduler");
      next();
      return;
    } else {
        item = {id:job._id,type:'job',meta:job.toObject()};
    }

    calipso.theme.renderItem(req,res,template,block,{item:item});

    next();

  });

}

function deleteJob(req,res,template,block,next,err) {

  var ScheduledJob = calipso.lib.mongoose.model('ScheduledJob');
  var jobName = req.moduleParams.jobName;

  ScheduledJob.remove({name:jobName}, function(err) {
    if(err) {
      req.flash("info","Unable to delete the job: " + jobName + " because " + err.message);
      res.redirect("/scheduler");
    } else {
      calipso.jobs[jobName].disable() // Disable it
      delete calipso.jobs[jobName];   // 'Delete' it - GC will get it later ???
      req.flash("info","Job: " + jobName + " has now been deleted.");
      res.redirect("/scheduler");
    }
    next();
  });

}

// Disable - same as reload
function disable() {
  reload();
}

// Reload
function reload() {

  // As the cron jobs are background tasks, we need to delete them all from the calipso object
  for(var jobName in calipso.jobs) {
    calipso.jobs[jobName].disable() // Disable it
    delete calipso.jobs[jobName];   // 'Delete' it - GC will get it later ???
  }

}
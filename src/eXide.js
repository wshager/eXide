/*
 *  eXide - web-based XQuery IDE
 *  
 *  Copyright (C) 2011 Wolfgang Meier
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// main entry point
$(document).ready(function() {
    window.name = "eXide";
    
    // parse query parameters passed in by URL:
    var qs = (function(a) {
        if (a == "") return {};
        var b = {};
        for (var i = 0; i < a.length; ++i)
        {
            var p=a[i].split('=');
            if (p.length != 2) continue;
            b[p[0]] = decodeURIComponent(p[1].replace(/\+/g, " "));
        }
        return b;
    })(window.location.search.substr(1).split('&'));
    
    // check parameters passed in GET request
    eXide.app.init(function (restored) {        
        var openDoc = qs["open"];
        var snippet = qs["snip"];
        if (openDoc && !restored[openDoc]) {
            eXide.app.findDocument(qs["open"]);
        } else if (snippet) {
            eXide.app.newDocument(snippet, "xquery");
        }
        if (window.opener && window.opener.eXide_onload) {
            window.opener.eXide_onload(eXide.app);
        }
    });
});

eXide.namespace("eXide.app");

/**
 * Static class for the main application. Controls the GUI.
 */
eXide.app = (function() {
    
	var editor;

	var deploymentEditor;
	var dbBrowser;
    var projects;
	var preferences;
    var templates = {};
    var menu;
	var hitCount = 0;
	var startOffset = 0;
	var currentOffset = 0;
	var endOffset = 0;
	
	var login = null;
    
    // used to detect when window looses focus
    var hasFocus = true;
    
	return {
        
		init: function(afterInitCallback) {
            menu = new eXide.util.Menubar($(".menu"));
            projects = new eXide.edit.Projects();
			editor = new eXide.edit.Editor(document.getElementById("editor"), menu);
			deploymentEditor = new eXide.edit.PackageEditor(projects);
			dbBrowser = new eXide.browse.Browser(document.getElementById("open-dialog"));
            deploymentEditor.addEventListener("change", null, function(collection) {
                dbBrowser.changeToCollection(collection);
                eXide.app.openDocument();
            });
			preferences = new eXide.util.Preferences(editor);
			
            editor.addEventListener("setTheme", eXide.app.setTheme);
            
            eXide.app.initGUI(menu);
			
            // save restored paths for later
            eXide.app.getLogin(function() {
                eXide.app.initStatus("Restoring state");
                eXide.app.restoreState(function(restored) {
                    editor.init();
                    if (afterInitCallback) {
                        afterInitCallback(restored);
                    }
                    // dirty workaround to fix editor height
                    $("body").layout().toggle("south");
                    
                    $("#splash").fadeOut(400);
                });
            });
		    
		    editor.addEventListener("outlineChange", eXide.app.onOutlineChange);

			$(window).resize(eXide.app.resize);
			
			$(window).unload(function () {
				eXide.app.saveState();
			});
            
            eXide.find.Modules.addEventListener("open", null, function (module) {
                eXide.app.findDocument(module.at);
            });
            eXide.find.Modules.addEventListener("import", null, function (module) {
                editor.exec("importModule", module.prefix, module.uri, module.at);
            });
		},

        hasFocus: function() {
            return hasFocus;
        },
        
		resize: function() {
			var panel = $("#editor");
			var header = $(".header");
//			panel.width($(".ui-layout-center").innerWidth() - 20);
//			panel.css("width", "100%");
//			panel.height($(".ui-layout-center").innerHeight() - header.height());
			editor.resize();
		},
        
		newDocument: function(data, type) {
			editor.newDocument(data, type);
		},
        
        newDocumentFromTemplate: function() {
            $("#dialog-templates").dialog("open");
            //editor.newDocumentFromTemplate("collection-config");
        },

		findDocument: function(path) {
			var doc = editor.getDocument(path);
			if (doc == null) {
				var resource = {
						name: path.match(/[^\/]+$/)[0],
						path: path
				};
				eXide.app.$doOpenDocument(resource);
			} else {
				editor.switchTo(doc);
			}
		},
		
		locate: function(type, path, symbol) {
			if (path == null) {
				editor.exec("locate", type, symbol);
			} else {
				var doc = editor.getDocument(path);
				if (doc == null) {
					var resource = {
							name: path.match(/[^\/]+$/)[0],
							path: path
					};
					eXide.app.$doOpenDocument(resource, function(doc) {
                        if (doc) {
                            editor.exec("locate", type, symbol);
                        }
					});
				} else {
					editor.switchTo(doc);
					editor.exec("locate", type, symbol);
				}
			}
		},
		
		openDocument: function() {
			dbBrowser.reload(["reload"], "open");
			$("#open-dialog").dialog("option", "title", "Open Document");
			$("#open-dialog").dialog("option", "buttons", { 
				"cancel": function() { $(this).dialog("close"); editor.focus(); },
				"open": eXide.app.openSelectedDocument
			});
			$("#open-dialog").dialog("open");
		},

		openSelectedDocument: function(close) {
			var resource = dbBrowser.getSelection();
			if (resource) {
				eXide.app.$doOpenDocument(resource);
			}
			if (close == undefined || close)
				$("#open-dialog").dialog("close");
		},

		$doOpenDocument: function(resource, callback, reload) {
			resource.path = eXide.util.normalizePath(resource.path);
            var doc = editor.getDocument(resource.path);
            if (doc && !reload) {
                editor.switchTo(doc);
                if (callback) {
                    callback(resource);
                }
                return true;
            }
			$.ajax({
				url: "modules/load.xql?path=" + resource.path,
				dataType: 'text',
				success: function (data, status, xhr) {
                    if (reload) {
                        editor.reload(data);
                    } else {
                        var mime = eXide.util.mimeTypes.getMime(xhr.getResponseHeader("Content-Type"));
                        var externalPath = xhr.getResponseHeader("X-Link");
                        editor.openDocument(data, mime, resource, externalPath);
                    }
					if (callback) {
						callback(resource);
					}
                    return true;
				},
				error: function (xhr, status) {
					eXide.util.error("Failed to load document " + resource.path + ": " + 
							xhr.status + " " + xhr.statusText);
                    if (callback) {
                        callback(null);
                    }
                    return false;
				}
			});
		},

        reloadDocument: function() {
            var doc = editor.getActiveDocument();
            if (doc.isSaved()) {
                eXide.app.$reloadDocument(doc);
            } else {
                eXide.util.Dialog.input("Reload Document", "Do you really want to reload the document?", function() {
                    eXide.app.$reloadDocument(doc);
                });
            }
        },
        
        $reloadDocument: function(doc) {
            var resource = {
                name: doc.getName(),
                path: doc.getPath()
            };
            eXide.app.$doOpenDocument(resource, null, true);
        },
        
		closeDocument: function() {
			if (!editor.getActiveDocument().isSaved()) {
				$("#dialog-confirm-close").dialog({
					resizable: false,
					height:140,
					modal: true,
					buttons: {
						"Close": function() {
							$( this ).dialog( "close" );
							editor.closeDocument();
						},
						Cancel: function() {
							$( this ).dialog( "close" );
						}
					},
                    open: function() { 
                        $(this).closest('.ui-dialog').find('.ui-dialog-buttonpane button:eq(0)').focus(); 
                        $(this).closest('.ui-dialog').find('.ui-dialog-buttonpane button:eq(1)').blur(); 
                    }
				});
                
			} else {
				editor.closeDocument();
			}
		},
		
		saveDocument: function() {
            eXide.app.requireLogin(function () {
                if (editor.getActiveDocument().getPath().match('^__new__')) {
        			dbBrowser.reload(["reload", "create"], "save");
    				$("#open-dialog").dialog("option", "title", "Save Document");
    				$("#open-dialog").dialog("option", "buttons", { 
    					"Cancel": function() {
                            $(this).dialog("close");
        				},
    					"Save": function() {
    						editor.saveDocument(dbBrowser.getSelection(), function () {
    							$("#open-dialog").dialog("close");
                                deploymentEditor.autoSync(editor.getActiveDocument().getBasePath());
                                eXide.app.updateStatus(this);
    						}, function (msg) {
    							eXide.util.Dialog.warning("Failed to Save Document", msg);
    						});
    					}
    				});
    				$("#open-dialog").dialog("open");
    			} else {
    				editor.saveDocument(null, function () {
    					eXide.util.message(editor.getActiveDocument().getName() + " stored.");
                        deploymentEditor.autoSync(editor.getActiveDocument().getBasePath());
    				}, function (msg) {
    					eXide.util.Dialog.warning("Failed to Save Document", msg);
    				});
    			}
            });
		},

        saveDocumentAs: function() {
            eXide.app.requireLogin(function () {
                dbBrowser.reload(["reload", "create"], "save");
    			$("#open-dialog").dialog("option", "title", "Save Document As ...");
    			$("#open-dialog").dialog("option", "buttons", { 
    				"Cancel": function() {
                        // restore old path
                        $(this).dialog("close");
    				},
    				"Save": function() {
    					editor.saveDocument(dbBrowser.getSelection(), function () {
    						$("#open-dialog").dialog("close");
                            deploymentEditor.autoSync(editor.getActiveDocument().getBasePath());
                            eXide.app.updateStatus(this);
    					}, function (msg) {
    						eXide.util.Dialog.warning("Failed to Save Document", msg);
    					});
    				}
    			});
    			$("#open-dialog").dialog("open");
            });
        },
        
        exec: function() {
            editor.exec(arguments);
        },
        
		download: function() {
			var doc = editor.getActiveDocument();
			if (doc.getPath().match("^__new__") || !doc.isSaved()) {
				eXide.util.error("There are unsaved changes in the document. Please save it first.");
				return;
			}
			window.location.href = "modules/load.xql?download=true&path=" + encodeURIComponent(doc.getPath());
		},
		
		runQuery: function() {
			editor.updateStatus("Running query ...");
			var code = editor.getText();
			var moduleLoadPath = "xmldb:exist://" + editor.getActiveDocument().getBasePath();
			$('#results-container .results').empty();
			$.ajax({
				type: "POST",
				url: "execute",
				dataType: "xml",
				data: { "qu": code, "base": moduleLoadPath },
				success: function (xml) {
					var elem = xml.documentElement;
					if (elem.nodeName == 'error') {
				        var msg = $(elem).text();
				        eXide.util.error(msg, "Compilation Error");
				        editor.evalError(msg);
					} else {
						editor.updateStatus("");
						editor.clearErrors();
						var layout = $("body").layout();
						layout.open("south");
						//layout.sizePane("south", 300);
						eXide.app.resize();
						
						startOffset = 1;
						currentOffset = 1;
						hitCount = elem.getAttribute("hits");
						endOffset = startOffset + 10 - 1;
						if (hitCount < endOffset)
							endOffset = hitCount;
						eXide.util.message("Found " + hitCount + " in " + elem.getAttribute("elapsed") + "s");
						eXide.app.retrieveNext();
					}
				},
				error: function (xhr, status) {
					eXide.util.error(xhr.responseText, "Server Error");
				}
			});
		},

		checkQuery: function() {
			editor.validate();
		},

		/** If there are more query results to load, retrieve
		 *  the next result.
		 */
		retrieveNext: function() {
			$.log("retrieveNext: %d", currentOffset);
		    if (currentOffset > 0 && currentOffset <= endOffset) {
		        var url = 'results/' + currentOffset;
				currentOffset++;
				$.ajax({
					url: url,
					dataType: 'html',
					success: function (data) {
						$('#results-container .results').append(data);
						$("#results-container .current").text("Showing results " + startOffset + " to " + (currentOffset - 1) +
								" of " + hitCount);
						$("#results-container .pos:last a").click(function () {
							eXide.app.findDocument($(this).data("path"));
							return false;
						});
						eXide.app.retrieveNext();
					}
				});
			} else {
		    }
		},

		/** Called if user clicks on "forward" link in query results. */
		browseNext: function() {
			if (currentOffset > 0 && endOffset < hitCount) {
				startOffset = currentOffset;
		        var howmany = 10;
		        endOffset = currentOffset + howmany - 1;
				if (hitCount < endOffset)
					endOffset = hitCount;
				$("#results-container .results").empty();
				eXide.app.retrieveNext();
			}
			return false;
		},
		
		/** Called if user clicks on "previous" link in query results. */
		browsePrevious: function() {
			if (currentOffset > 0 && startOffset > 1) {
		        var count = 10;
		        startOffset = startOffset - count;
				if (startOffset < 1)
					startOffset = 1;
				currentOffset = startOffset;
				endOffset = currentOffset + (count - 1);
				if (hitCount < endOffset)
					endOffset = hitCount;
				$("#results-container .results").empty();
				eXide.app.retrieveNext();
			}
			return false;
		},
		
		manage: function() {
			eXide.app.requireLogin(function() {
                dbBrowser.reload(["reload", "create", "upload", "properties", "open", "cut", "copy", "paste"], "manage");
                $("#open-dialog").dialog("option", "title", "DB Manager");
                $("#open-dialog").dialog("option", "buttons", { 
                    "Close": function() { $(this).dialog("close"); }
                });
                $("#open-dialog").dialog("open");
			});
		},
		
		/** Open deployment settings for current app */
		deploymentSettings: function() {
			var path = editor.getActiveDocument().getPath();
			var collection = /^(.*)\/[^\/]+$/.exec(path);
			if (!collection)
				return;
			eXide.app.requireLogin(function() {
                $.log("Editing deployment settings for collection: %s", collection[1]);
    		    deploymentEditor.open(collection[1]);
			});
		},
		
		newDeployment: function() {
			eXide.app.requireLogin(function() {
    			deploymentEditor.open();
			});
		},
		
		deploy: function() {
            eXide.app.requireLogin(function() {
    			var path = editor.getActiveDocument().getPath();
    			var collection = /^(.*)\/[^\/]+$/.exec(path);
    			if (!collection) {
    				eXide.util.error("The file open in the editor does not belong to an application package!");
    				return false;
    			}
    			$.log("Deploying application from collection: %s", collection[1]);
    			deploymentEditor.deploy(collection[1]);
            });
			return false;
		},
		
		synchronize: function() {
            eXide.app.requireLogin(function () {
                var path = editor.getActiveDocument().getPath();
        		var collection = /^(.*)\/[^\/]+$/.exec(path);
    			if (!collection) {
                    eXide.util.error("The file open in the editor does not belong to an application package!");
    				return;
    			}
    			deploymentEditor.synchronize(collection[1]);
            });
		},
		
        downloadApp: function () {
            eXide.app.requireLogin(function() {
                var path = editor.getActiveDocument().getPath();
            	var collection = /^(.*)\/[^\/]+$/.exec(path);
                $.log("downloading %s", collection);
    			if (!collection) {
                    eXide.util.error("The file open in the editor does not belong to an application package!");
    				return;
    			}
    			deploymentEditor.download(collection[1]);
            });
        },
        
		openApp: function () {
			var path = editor.getActiveDocument().getPath();
			var collection = /^(.*)\/[^\/]+$/.exec(path);
			if (!collection) {
                eXide.util.error("The file open in the editor does not belong to an application package!");
				return;
			}
			deploymentEditor.runApp(collection[1]);
		},
        
		restoreState: function(callback) {
			if (!eXide.util.supportsHtml5Storage)
				return false;
			preferences.read();
			
            var restoring = {};
            
			var docCount = localStorage["eXide.documents"];
			if (!docCount)
				docCount = 0;
            // we need to restore documents one after the other
            var docsToLoad = [];
			for (var i = 0; i < docCount; i++) {
				var doc = {
						path: localStorage["eXide." + i + ".path"],
						name: localStorage["eXide." + i + ".name"],
						writable: (localStorage["eXide." + i + ".writable"] == "true"),
						line: parseInt(localStorage["eXide." + i + ".last-line"])
				};
                if (!doc.name) {
                    continue;
                }
				$.log("Restoring doc %s, going to line = %i", doc.path, doc.line);
				var data = localStorage["eXide." + i + ".data"];
				if (data) {
					editor.newDocumentWithText(data, localStorage["eXide." + i + ".mime"], doc);
				} else {
                    docsToLoad.push(doc);
				}
                restoring[doc.path] = doc;
			}
            this.restoreDocs(docsToLoad, function() {
                if (!editor.getActiveDocument()) {
                    eXide.app.newDocument("", "xquery");
                }
                editor.triggerCheck();
                if (callback) callback(restoring);
            });
			deploymentEditor.restoreState();
			return restoring;
		},
		
        restoreDocs: function(docs, callback) {
            if (docs.length == 0) {
                callback();
                return;
            }
            var self = this;
            var doc = docs.pop();
            eXide.app.$doOpenDocument(doc, function() {
                self.restoreDocs(docs, callback);
            });
        },
        
		saveState: function() {
			if (!eXide.util.supportsHtml5Storage)
				return;
			localStorage.clear();
			preferences.save();
			
			editor.saveState();
			deploymentEditor.saveState();
		},
		
        getLogin: function(callback) {
            $.ajax({
                url: "login",
                dataType: "json",
                success: function(data) {
                    eXide.app.login = data;
                    $("#user").text("Logged in as " + eXide.app.login.user + ". ");
                    if (callback) callback();
                },
                error: function (xhr, textStatus) {
                    eXide.app.login = null;
                    $("#user").text("Login");
                    if (callback) callback();
                }
            })
        },
        
		$checkLogin: function () {
			if (eXide.app.login)
				return true;
			eXide.util.error("Warning: you are not logged in.");
			return false;
		},
		
        requireLogin: function(callback) {
            if (!eXide.app.login) {
                $("#login-dialog").dialog("option", "close", function () {
                    if (eXide.app.login) {
                        callback();
                    } else {
                        eXide.util.error("Warning: you are not logged in!");
                    }
                });
                $("#login-dialog").dialog("open");
            } else
                callback();
        },
        
        showPreferences: function() {
            preferences.show();
        },
        
        getPreference: function(key) {
            return preferences.get(key);
        },

        startDebug: function() {
            var _class1 = "ui-icon-stop";
            var _class2 = "ui-icon-play";
            var _icon = $("#debug span.ui-icon");
            if (_icon.hasClass(_class1)){
                _icon.removeClass(_class1);
                _icon.addClass(_class2);
            } else {
                _icon.removeClass(_class2);
                _icon.addClass(_class1);
            }
            editor.exec("debug");
            $.log("start debugging click");
        },

        stepOver: function() {
            editor.exec("stepOver");
        },

        stepInto: function() {
            editor.exec("stepInto");
        },
        
        setTheme: function(theme) {
            $("#outline-body").removeClass().addClass(theme.cssClass);
            $("#results-body").removeClass().addClass(theme.cssClass);
        },
        
        updateStatus: function(doc) {
            $("#syntax").val(doc.getSyntax());
            $("#status span").text(eXide.util.normalizePath(doc.getPath()));
            if (!doc.isNew() && (doc.getSyntax() == "xquery" || doc.getSyntax() == "html" || doc.getSyntax() == "xml")) {
                $("#status a").attr("href", doc.getExternalLink());
                $("#status a").css("visibility", "visible");
            } else {
                $("#status a").css("visibility", "hidden");
            }
        },
        
        initStatus: function(msg) {
            $("#splash-status").text(msg);
        },
        
		initGUI: function(menu) {
			var layout = $("body").layout({
				enableCursorHotkey: false,
                spacing_open: 6,
                spacing_closed: 8,
				north__size: 70,
				north__resizable: false,
				north__closable: false,
                north__showOverflowOnHover: true,
                north__spacing_open: 0,
				south__minSize: 200,
                south__size: 300,
				south__initClosed: false,
                south__contentSelector: "#results-body",
				west__size: 200,
				west__initClosed: false,
				west__contentSelector: ".content",
                east__initClosed: true,
				center__minSize: 300,
			    center__onresize: eXide.app.resize,
				center__contentSelector: ".content"
			});
            
			$("#open-dialog").dialog({
				title: "Open file",
				modal: false,
		        autoOpen: false,
		        height: 480,
		        width: 600,
				open: function() { dbBrowser.init(); },
				resize: function() { dbBrowser.resize(); }
			});
			$("#login-dialog").dialog({
				title: "Login",
				modal: true,
				autoOpen: false,
				buttons: {
					"Login": function() {
                        var user = $("#login-form input[name=\"user\"]").val();
                        var password = $("#login-form input[name=\"password\"]").val();
                        var params = {
                            user: user, password: password
                        }
                        if ($("#login-form input[name=\"duration\"]").is(":checked")) {
                            params.duration = "P14D";
                        }
						$.ajax({
							url: "login",
							data: params,
                            dataType: "json",
							success: function (data) {
								eXide.app.login = data;
								$.log("Logged in as %s. Is dba: %s", eXide.app.login.user, eXide.app.login.isAdmin);
								$("#login-dialog").dialog("close");
								$("#user").text("Logged in as " + eXide.app.login.user + ". ");
								editor.focus();
							},
							error: function (xhr, status, data) {
								$("#login-error").text("Login failed. " + data);
								$("#login-dialog input:first").focus();
							}
						});
					},
					"Cancel": function () { $(this).dialog("close"); editor.focus(); }
				},
				open: function() {
					// clear form fields
					$(this).find("input").val("");
					$(this).find("input:first").focus();
					$("#login-error").empty();
					
					var dialog = $(this);
					dialog.find("input").keyup(function (e) {
						if (e.keyCode == 13) {
				           dialog.parent().find(".ui-dialog-buttonpane button:first").trigger("click");
				        }
					});
				}
			});
			$("#keyboard-help").dialog({
				title: "Keyboard Shortcuts",
				modal: false,
				autoOpen: false,
				height: 400,
				buttons: {
					"Close": function () { $(this).dialog("close"); }
				},
				open: function () {
					eXide.edit.commands.help($("#keyboard-help"), editor);
				}
			});
            $("#about-dialog").dialog({
                title: "About",
                modal: false,
                autoOpen: false,
                height: 300,
                width: 450,
                buttons: {
    				"Close": function () { $(this).dialog("close"); }
				}
            });
            $("#dialog-templates").dialog({
    			title: "New document",
				modal: false,
		        autoOpen: false,
		        height: 280,
		        width: 550,
                dataType: "json",
                open: function() {
                    $.ajax({
                	    url: "modules/get-template.xql",
            			type: "POST",
            			success: function(data) {
                		    templates = data;
                            $("#dialog-templates .templates").hide();
                            $("#dialog-templates .type-select").val("");
            			}
                    });
                },
                buttons: {
				    "Cancel": function () { $(this).dialog("close"); editor.focus(); },
                    "Create": function() {
                        var mode = $(this).find(".type-select").val();
                        var template = $(this).find(".templates select").val();
                        $.log("creating new doc with mode: %s and template: %s", mode, template);
                        editor.newDocumentFromTemplate(mode, template);
                        $(this).dialog("close");
                        editor.focus();
                    }
                }
			});
            $("#dialog-templates .type-select").change(function() {
                var templ = $("#dialog-templates .templates");
                var templSel = $("select", templ);
                var type = $(this).val();
                templSel.empty();
                var mode = templates[type];
                if (mode) {
                    var options = "<option value=''>None</option>";
                    for (var i = 0; i < mode.length; i++) {
                        options += "<option value='" + mode[i].name + "'>" + mode[i].description + "</option>";
                    }
                    templSel.html(options);
                    templ.show();
                } else {
                    templ.hide();
                }
            });
            
			// initialize buttons and menu events
			var button = $("#open").button({
				icons: {
					primary: "ui-icon-folder-open"
				}
			});
			button.click(eXide.app.openDocument);
            menu.click("#menu-file-open", eXide.app.openDocument, "openDocument");
			
			button = $("#close").button({
				icons: {
					primary: "ui-icon-close"
				}
			});
			button.click(eXide.app.closeDocument);
			menu.click("#menu-file-close", eXide.app.closeDocument, "closeDocument");
			
			button = $("#new").button({
				icons: {
					primary: "ui-icon-document"
				}
			});
			button.click(function() {
                eXide.app.newDocumentFromTemplate();
			});
            button = $("#new-xquery").button({
    			icons: {
					primary: "ui-icon-document"
				}
			});
			button.click(function() {
                eXide.app.newDocument(null, "xquery");
			});
			menu.click("#menu-file-new", eXide.app.newDocumentFromTemplate, "newDocumentFromTemplate");
    		menu.click("#menu-file-new-xquery", function() {
                eXide.app.newDocument(null, "xquery");
    		}, "newXQuery");
            
			button = $("#run").button({
				icons: {
					primary: "ui-icon-play"
				}
			});
			button.click(eXide.app.runQuery);

            button = $("#debug").button({
                icons: {
                    primary: "ui-icon-seek-end"
                }
            });
            button.click(eXide.app.startDebug);

            button = $("#debug-actions #step-over").button({
                icons: {
                    primary: "ui-icon-seek-end"
                }
            });
            button.click(eXide.app.stepOver);

            button = $("#debug-actions #step-into").button({
                icons: {
                    primary: "ui-icon-seek-end"
                }
            });
            button.click(eXide.app.stepInto);

            button = $("#debug-actions #step-out").button({
                icons: {
                    primary: "ui-icon-seek-end"
                }
            });
            button.click(eXide.app.startDebug);

			button = $("#validate").button({
				icons: {
					primary: "ui-icon-check"
				}
			});
			button.click(eXide.app.checkQuery);
			button = $("#save").button({
				icons: {
					primary: "ui-icon-disk"
				}
			});
			button.click(eXide.app.saveDocument);
			menu.click("#menu-file-save", eXide.app.saveDocument, "saveDocument");
            menu.click("#menu-file-save-as", eXide.app.saveDocumentAs);
			
            menu.click("#menu-file-reload", eXide.app.reloadDocument);
            
			button = $("#download").button({
				icons: {
					primary: "ui-icon-transferthick-e-w"
				}
			});
			button.click(eXide.app.download);
			menu.click("#menu-file-download", eXide.app.download);
			menu.click("#menu-file-manager", eXide.app.manage, "dbManager");
			// menu-only events
			menu.click("#menu-deploy-new", eXide.app.newDeployment);
			menu.click("#menu-deploy-edit", eXide.app.deploymentSettings);
			menu.click("#menu-deploy-deploy", eXide.app.deploy);
			menu.click("#menu-deploy-sync", eXide.app.synchronize, "synchronize");
            menu.click("#menu-deploy-download", eXide.app.downloadApp);
			menu.click("#menu-edit-undo", function () {
				editor.editor.undo();
			}, "undo");
			menu.click("#menu-edit-redo", function () {
				editor.editor.redo();
			}, "redo");
            menu.click("#menu-edit-find", function() {
                editor.quicksearch.start();
            }, "searchIncremental");
            menu.click("#menu-edit-toggle-comment", function () {
                editor.editor.toggleCommentLines();
            }, "toggleComment");
			menu.click("#menu-edit-preferences", function() {
                preferences.show(); 		
			}, "preferences");
            menu.click("#menu-navigate-definition", function () {
                editor.exec("gotoDefinition");
            }, "gotoDefinition");
            menu.click("#menu-navigate-modules", function () {
                var doc = editor.getActiveDocument();
	    		eXide.find.Modules.select(doc.syntax);
            }, "findModule");
            menu.click("#menu-navigate-info", function() {
                editor.exec("showFunctionDoc");
            }, "functionDoc");
			menu.click("#menu-deploy-run", eXide.app.openApp, "openApp");
			
            menu.click("#menu-help-keyboard", function (ev) {
				$("#keyboard-help").dialog("open");
			});
            menu.click("#menu-help-about", function (ev) {
				$("#about-dialog").dialog("open");
			});
            menu.click("#menu-help-hints", function(ev) {
                eXide.util.Help.show();
            });
			// syntax drop down
			$("#syntax").change(function () {
				editor.setMode($(this).val());
			});
			// register listener to update syntax drop down
			editor.addEventListener("activate", null, function (doc) {
                eXide.app.updateStatus(doc);
                projects.findProject(doc.getBasePath(), function(app) {
                    if (app) {
                        $("#toolbar-current-app").text(app.abbrev);
                        $("#menu-deploy-active").text(app.abbrev);
                    } else {
                        $("#toolbar-current-app").text("unknown");
                        $("#menu-deploy-active").text("unknown");
                    }
                });
			});
			
			$("#user").click(function (ev) {
				ev.preventDefault();
				if (eXide.app.login) {
					// logout
					$.get("login?logout=logout");
					$("#user").text("Login");
					eXide.app.login = null;
				} else {
					$("#login-dialog").dialog("open");
				}
			});
			$('#results-container .next').click(eXide.app.browseNext);
			$('#results-container .previous').click(eXide.app.browsePrevious);
            
            $("#error-status").mouseover(function(ev) {
                var error = this;
                $("#ext-status-bar").each(function() {
                    this.innerHTML = error.innerHTML;
                    $(this).css("display", "block");
                });
            });
            $("#ext-status-bar").mouseout(function(ev) {
               $(this).css("display", "none");
            });
            
            $(window).blur(function() {
                hasFocus = false;
            });
            $(window).focus(function() {
                var checkLogin = !hasFocus;
                hasFocus = true;
                if (checkLogin) {
                   eXide.app.getLogin();
                } 
            });
		}
	};
}());
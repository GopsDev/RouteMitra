app_name = "routemitra"
app_title = "RouteMitra"
app_publisher = "Gopal"
app_description = "RouteMitra: customer maps, auto-geocoding, beat plans and GPS-verified sales visits for ERPNext"
app_email = "rsgopal98@gmail.com"
app_license = "mit"

required_apps = ["erpnext"]

# RouteMitra icon on the apps screen; it opens the RouteMitra sidebar in the Desk.
add_to_apps_screen = [
	{
		"name": "routemitra",
		"logo": "/assets/routemitra/images/routemitra-logo.svg",
		"title": "RouteMitra",
		"route": "/desk/customer-map",
		"has_permission": "routemitra.routemitra_core.field_access.has_app_permission",
	}
]

# Field reps land on the mobile page (/routemitra) after login; managers stay on the Desk.
on_login = "routemitra.routemitra_core.field_access.on_login"

# Reps see only their own Sales Person's plans and visits; managers see everyone's.
permission_query_conditions = {
	"Beat Plan": "routemitra.routemitra_core.field_access.beat_plan_query_conditions",
	"Sales Visit": "routemitra.routemitra_core.field_access.sales_visit_query_conditions",
}
has_permission = {
	"Beat Plan": "routemitra.routemitra_core.field_access.has_sales_person_permission",
	"Sales Visit": "routemitra.routemitra_core.field_access.has_sales_person_permission",
}

# The mobile page used to live at /field; keep old links and home-screen shortcuts working.
website_redirects = [{"source": "/field", "target": "/routemitra"}]

after_install = "routemitra.install.after_install"
after_migrate = "routemitra.install.after_migrate"

extend_bootinfo = "routemitra.routemitra_core.doctype.routemitra_settings.routemitra_settings.boot_session"

app_include_js = "/assets/routemitra/js/routemitra.js"

scheduler_events = {
	"daily": [
		"routemitra.routemitra_core.doctype.sales_visit.fraud.flag_unclosed_visits",
		"routemitra.routemitra_core.notifications.mark_missed_stops",
	],
}

doctype_js = {"Address": "routemitra_core/customization/address/address.js"}

doc_events = {
	"Address": {
		"on_update": "routemitra.routemitra_core.customization.address.address.on_update",
	},
}

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "routemitra",
# 		"logo": "/assets/routemitra/logo.png",
# 		"title": "RouteMitra",
# 		"route": "/routemitra",
# 		"has_permission": "routemitra.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/routemitra/css/routemitra.css"
# app_include_js = "/assets/routemitra/js/routemitra.js"

# include js, css files in header of web template
# web_include_css = "/assets/routemitra/css/routemitra.css"
# web_include_js = "/assets/routemitra/js/routemitra.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "routemitra/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "routemitra/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "routemitra.utils.jinja_methods",
# 	"filters": "routemitra.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "routemitra.install.before_install"
# after_install = "routemitra.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "routemitra.uninstall.before_uninstall"
# after_uninstall = "routemitra.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "routemitra.utils.before_app_install"
# after_app_install = "routemitra.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "routemitra.utils.before_app_uninstall"
# after_app_uninstall = "routemitra.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "routemitra.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "routemitra.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"routemitra.tasks.all"
# 	],
# 	"daily": [
# 		"routemitra.tasks.daily"
# 	],
# 	"hourly": [
# 		"routemitra.tasks.hourly"
# 	],
# 	"weekly": [
# 		"routemitra.tasks.weekly"
# 	],
# 	"monthly": [
# 		"routemitra.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "routemitra.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "routemitra.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "routemitra.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "routemitra.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["routemitra.utils.before_request"]
# after_request = ["routemitra.utils.after_request"]

# Job Events
# ----------
# before_job = ["routemitra.utils.before_job"]
# after_job = ["routemitra.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"routemitra.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []


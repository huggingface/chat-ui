import { derived } from "svelte/store";
import { useSettingsStore } from "./settings";

// Define available languages
export const LANGUAGES: { [key: string]: string } = {
	en: "English",
	fr: "Français",
};

// Define the translation type
export type TranslationKey = string;
export type TranslationDictionary = Record<TranslationKey, string>;
export type Translations = Record<string, TranslationDictionary>;

// Create the translations
const translations: Translations = {
	en: {
		// Thumbnail
		ai_assistant: "AI assistant",
		assistant_created_by: "An AI assistant created by",

		// Assistants page
		popular_assistants: "Popular assistants made by the community",
		all_models: "All models",
		show_unfeatured_assistants: "Show unfeatured assistants",
		create_new_assistant: "Create new assistant",
		filter_by_name: "Filter by name",
		assistants_by: "{username}'s Assistants",
		view_on_hf: "View {username} on HF",
		community: "Community",
		no_assistants_found: "No assistants found",
		number_of_users: "Number of users",

		// Web search
		web_search: "Web Search",
		completed: "Completed",
		an_error_occurred: "An error occurred",
		search_web: "Search web",
		web_search_toggle: "Web Search Toggle",
		web_search_description:
			"When enabled, the model will try to complement its answer with information queried from the web.",

		// Tokens
		tokens_usage: "Tokens usage",

		// Buttons
		retry: "Retry",
		copy_to_clipboard: "Copy to clipboard",
		copied: "Copied",
		sign_in: "Sign in",
		with: "with",
		start_chatting: "Start chatting",
		continue_as_guest: "Continue as guest",
		explore_the_app: "Explore the app",

		// Application settings
		application_settings: "Application Settings",
		latest_deployment: "Latest deployment",
		share_conversations: "Share conversations with model authors",
		sharing_data_help:
			"Sharing your data will help improve the training data and make open models better over time.",
		hide_emoticons: "Hide emoticons in conversation topics",
		emoticons_shown: "Emoticons are shown in the sidebar by default, enable this to hide them.",
		disable_streaming: "Disable streaming tokens",
		paste_text: "Paste text directly into chat",
		paste_text_description:
			"By default, when pasting long text into the chat, we treat it as a plaintext file. Enable this to paste directly into the chat instead.",
		share_feedback: "Share your feedback on HuggingChat",
		delete_conversations: "Delete all conversations",
		language_selection: "Language",
		language_description: "Select your preferred language for the user interface.",
		browser_default: "Browser Default",

		// Confirmation dialogs
		confirm_delete: "Are you sure you want to delete all conversations?",
		confirm_share: "Are you sure you want to share this conversation? This cannot be undone.",

		// Common UI elements
		save: "Save",
		cancel: "Cancel",
		close: "Close",
		loading: "Loading...",
		error: "Error",
		error_creating_conversation: "Error while creating conversation, try again.",
		success: "Success",
		delete: "Delete",
		upload: "Upload",
		create: "Create",
		continue: "Continue",
		name: "Name",
		description: "Description",
		public: "public",
		experimental: "Experimental",
		default: "Default",
		active: "Active",
		give_feedback: "Give feedback",
		only_images_allowed: "Only images are allowed",

		// Mobile navigation
		open_menu: "Open menu",
		close_menu: "Close menu",

		// Conversation items
		assistant_avatar: "Assistant avatar",
		cancel_delete_action: "Cancel delete action",
		confirm_delete_action: "Confirm delete action",
		edit_conversation_title: "Edit conversation title",
		edit_this_conversation_title: "Edit this conversation title:",
		delete_conversation: "Delete conversation",

		// Upload
		upload_file: "Upload file",

		// Navigation
		new_chat: "New Chat",
		today: "Today",
		this_week: "This week",
		this_month: "This month",
		older: "Older",
		sign_out: "Sign Out",
		login: "Login",
		theme: "Theme",
		models: "Models",
		all_models_available: "All models available on",
		assistants: "Assistants",
		my_assistants: "My Assistants",
		other_assistants: "Other Assistants",
		browse_assistants: "Browse Assistants",
		tools: "Tools",
		settings: "Settings",
		about_privacy: "About & Privacy",
		new: "New",

		// Tools page
		popular_tools: "Popular tools made by the community",
		experimental_feature: "experimental",
		share_feedback_with_us: "sharing your feedback with us",
		show_unfeatured_tools: "Show unfeatured tools",
		create_new_tool: "Create new tool",
		active_tools: "Active",
		community_tools: "Community",
		filter_tools_by_name: "Filter by name",
		no_tools_found: "No tools found",
		no_active_tools: "You don't have any active tools.",
		runs: "runs",
		run: "run",
		internal_tool: "Internal tool",
		added_by: "Added by",
		huggingchat_official_tool: "HuggingChat official tool",
		model_not_supporting_tools:
			"You are currently not using a model that supports tools. Activate one",
		here: "here",
		tools_description:
			"Tools are applications that the model can choose to call while you are chatting with it.",
		this_feature_is: "This feature is",
		consider: "Consider",
		trending: "trending",
		popular: "popular",

		// Tool detail page
		view_tool: "View",
		edit_tool: "Edit",
		tool_colon: "Tool:",
		modify_tool_description: "Modifying an existing tool will propagate the changes to all users.",
		create_tool_description: "Create and share your own tools. All tools are",
		activate: "Activate",
		deactivate: "Deactivate",
		edit: "Edit",
		view_spec: "View spec",
		duplicate: "Duplicate",
		report: "Report",
		reported: "Reported",
		delete_tool_confirmation: "Are you sure you want to delete this tool?",
		force_feature: "Force feature",
		approve: "Approve",
		deny: "Deny",
		reset_review: "Reset review",
		request_to_be_featured: "Request to be featured",
		request_to_be_featured_confirmation:
			"Are you sure you want to request this tool to be featured? Make sure you have tried the tool and that it works as expected. We will review your request once submitted.",
		direct_url: "Direct URL",
		share_tool_link: "Share this link with people to use your tool.",
		copy: "Copy",

		// Tool edit page
		tool_display_name: "Tool Display Name",
		icon: "Icon",
		color_scheme: "Color scheme",
		tool_description: "Tool Description",
		tool_description_help:
			"This description will be passed to the model when picking tools. Describe what your tool does and when it is appropriate to use.",
		huggingface_space_url: "Hugging Face Space URL",
		huggingface_space_url_help: "Specify the Hugging Face Space where your tool is hosted.",
		see_trending_spaces: "See trending spaces here",
		tools_explanation:
			"Tools allows models that support them to use external application directly via function calling. Tools must use Hugging Face Gradio Spaces as we detect the input and output types automatically from the",
		gradio_api: "Gradio API",
		for_gpu_intensive: "For GPU intensive tool consider using a ZeroGPU Space.",
		functions: "Functions",
		choose_functions: "Choose functions that can be called in your tool.",
		start_by_specifying: "Start by specifying a Hugging Face Space URL.",
		loading_api: "Loading API...",
		no_endpoints_found: "No endpoints found in this space. Try another one.",
		ai_function_name: "AI Function Name",
		ai_function_name_help:
			"This is the function name that will be used when prompting the model. Make sure it describes your tool well, is short and unique.",
		arguments: "Arguments",
		choose_parameters: "Choose parameters that can be passed to your tool.",
		required: "Required",
		optional: "Optional",
		fixed: "Fixed",
		description_help:
			"Will be passed in the model prompt, make it as clear and concise as possible",
		default_value: "Default value",
		value: "Value",
		default_value_help:
			"The tool will use this value by default but the model can specify a different one.",
		fixed_value_help: "The tool will use this value and it cannot be changed.",
		mime_types: "MIME types",
		mime_types_help:
			"This input is a file. Specify the MIME types that are allowed to be passed to the tool.",
		output_options: "Output options",
		choose_output_value: "Choose what value your tool will return and how",
		output_component: "Output component",
		output_component_help:
			"Pick the gradio output component whose output will be used in the tool.",
		show_output_directly: "Show output to user directly",
		show_output_directly_help:
			"Some tools return long context that should not be shown to the user directly.",
		saving: "Saving...",

		// Chat
		ask_anything: "Ask anything",
		send_message: "Send message",
		sorry_error: "Sorry, something went wrong. Please try again.",
		model: "Model",
		generated_content_warning: "Generated content may be inaccurate or false.",
		share_conversation: "Share this conversation",
		link_copied: "Link copied to clipboard",
		read_only: "This conversation is read-only.",
		stop_generating: "Stop generating",
		confirm_delete_branch: "Are you sure you want to delete this branch?",

		// Assistant introduction
		assistant: "Assistant",
		assistant_uses_tools: "This assistant uses tools",
		has_tools: "Has tools",
		assistant_uses_websearch: "This assistant uses the websearch",
		has_internet_access: "Has internet access",
		created_by: "Created by",
		users: "users",
		share: "Share",
		reset_to_default_model: "Reset to default model",

		// Assistant page
		model_colon: "Model:",
		remove: "Remove",
		share_link_description: "Share this link for people to use your assistant.",
		system_instructions: "System Instructions",
		assistant_has_tools: "This Assistant has access to the following tools:",
		internet_access: "Internet Access",
		assistant_uses_web_search: "This Assistant uses Web Search to find information on Internet.",
		assistant_can_search_domains: "This Assistant can use Web Search on the following domains:",
		assistant_can_browse_links: "This Assistant can browse the following links:",
		assistant_has_dynamic_prompts:
			"This Assistant has dynamic prompts enabled and can make requests to external services.",
		delete_assistant_confirmation: "Are you sure you want to delete this assistant?",
		copy_direct_link: "Copy direct link to model",
		model_page: "Model page",
		dataset_page: "Dataset page",
		model_website: "Model website",
		api_playground: "API Playground",
		reset: "Reset",
		custom_system_prompt: "Custom system prompt",

		// Chat input
		search_the_web: "Search the web",
		search: "Search",
		generate_images: "Generate images",
		image_gen: "Image Gen",
		upload_any_file: "Upload any file",
		upload_files: "Upload {types} files",
		document_parser: "Document Parser",
		capture_screenshot: "Capture screenshot",
		browse_more_tools: "Browse more tools",

		// Chat introduction
		default_app_description: "Making the community's best AI chat models available to everyone.",
		current_model: "Current Model",
		examples: "Examples",

		// Chat message
		sources: "Sources",
		download_prompt_parameters: "Download prompt and parameters",
		branch: "Branch",
		submit: "Submit",

		// File dropzone
		file_type_not_supported:
			"Some file type not supported. Only allowed: {allowed}. Uploaded document is of type {type}",
		file_too_big: "Some file is too big. (10MB max)",
		drop_file_to_chat: "Drop File to add to chat",

		// Model switch
		model_no_longer_available:
			"This model is no longer available. Switch to a new one to continue this conversation:",
		accept: "Accept",

		// Open reasoning results
		reasoning: "Reasoning",

		// Tool update
		error_calling: "Error calling",
		called: "Called",
		calling: "Calling",
		tool: "tool",
		parameters: "Parameters",
		result: "Result",

		// Report modal
		report_content: "Report content",
		report_description: "Please provide a brief description of why you are reporting this content.",
		report_reason_placeholder: "Reason(s) for the report",
		submit_report: "Submit report",

		// Assistant settings
		edit_assistant: "Edit Assistant",
		modify_assistant_description:
			"Modifying an existing assistant will propagate the changes to all users.",
		create_assistant_description: "Create and share your own AI Assistant. All assistants are",
		assistant_name_placeholder: "Assistant Name",
		assistant_description_placeholder: "It knows everything about python",
		avatar: "Avatar",
		temperature: "Temperature",
		temperature_tooltip: "Temperature: Controls creativity, higher values allow more variety.",
		top_p: "Top P",
		top_p_tooltip: "Top P: Sets word choice boundaries, lower values tighten focus.",
		repetition_penalty: "Repetition penalty",
		repetition_penalty_tooltip:
			"Repetition penalty: Prevents reuse, higher values decrease repetition.",
		top_k: "Top K",
		top_k_tooltip: "Top K: Restricts word options, lower values for predictability.",
		user_start_messages: "User start messages",
		start_message_1: "Start Message 1",
		start_message_2: "Start Message 2",
		start_message_3: "Start Message 3",
		start_message_4: "Start Message 4",
		choose_tools_description:
			"Choose up to 3 community tools that will be used with this assistant.",
		domains_search: "Domains search",
		domains_search_description:
			"Specify domains and URLs that the application can search, separated by commas.",
		specific_links: "Specific Links",
		specific_links_description:
			"Specify a maximum of 10 direct URLs that the Assistant will access. HTML & Plain Text only, separated by commas",
		instructions_system_prompt: "Instructions (System Prompt)",
		template_variable: "template variable",
		template_variables_description:
			"Will perform a GET or POST request and inject the response into the prompt. Works better with plain text, csv or json content.",
		dynamic_prompt: "Dynamic Prompt",
		dynamic_prompt_description:
			"Allow the use of template variables {get_example} to insert dynamic content into your prompt by making GET requests to specified URLs on each inference. You can also send the user's message as the body of a POST request, using {post_example}. Use {today_example} to include the current date.",
		system_prompt_placeholder: "You'll act as...",
	},
	fr: {
		// Vignette
		ai_assistant: "Assistant IA",
		assistant_created_by: "Un assistant IA créé par",

		// Page des assistants
		popular_assistants: "Assistants populaires créés par la communauté",
		all_models: "Tous les modèles",
		show_unfeatured_assistants: "Afficher les assistants non mis en avant",
		create_new_assistant: "Créer un nouvel assistant",
		filter_by_name: "Filtrer par nom",
		assistants_by: "Assistants de {username}",
		view_on_hf: "Voir {username} sur HF",
		community: "Communauté",
		no_assistants_found: "Aucun assistant trouvé",
		number_of_users: "Nombre d'utilisateurs",

		// Recherche web
		web_search: "Recherche Web",
		completed: "Terminé",
		an_error_occurred: "Une erreur s'est produite",
		search_web: "Rechercher sur le web",
		web_search_toggle: "Activer la recherche web",
		web_search_description:
			"Lorsque cette option est activée, le modèle essaiera de compléter sa réponse avec des informations recherchées sur le web.",

		// Tokens
		tokens_usage: "Utilisation des tokens",

		// Buttons
		retry: "Réessayer",
		copy_to_clipboard: "Copier dans le presse-papiers",
		copied: "Copié",
		sign_in: "Se connecter",
		with: "avec",
		start_chatting: "Commencer à discuter",
		continue_as_guest: "Continuer en tant qu'invité",
		explore_the_app: "Explorer l'application",

		// Paramètres de l'application
		application_settings: "Paramètres de l'Application",
		latest_deployment: "Dernier déploiement",
		share_conversations: "Partager les conversations avec les auteurs du modèle",
		sharing_data_help:
			"Le partage de vos données aidera à améliorer les données d'entraînement et à perfectionner les modèles ouverts au fil du temps.",
		hide_emoticons: "Masquer les émoticônes dans les sujets de conversation",
		emoticons_shown:
			"Les émoticônes sont affichées dans la barre latérale par défaut, activez cette option pour les masquer.",
		disable_streaming: "Désactiver le streaming des tokens",
		paste_text: "Coller du texte directement dans le chat",
		paste_text_description:
			"Par défaut, lorsque vous collez un texte long dans le chat, nous le traitons comme un fichier texte brut. Activez cette option pour coller directement dans le chat.",
		share_feedback: "Partagez vos commentaires sur HuggingChat",
		delete_conversations: "Supprimer toutes les conversations",
		language_selection: "Langue",
		language_description: "Sélectionnez votre langue préférée pour l'interface utilisateur.",
		browser_default: "Langue du navigateur",

		// Boîtes de dialogue de confirmation
		confirm_delete: "Êtes-vous sûr de vouloir supprimer toutes les conversations ?",
		confirm_share:
			"Êtes-vous sûr de vouloir partager cette conversation ? Cette action ne peut pas être annulée.",

		// Éléments d'interface communs
		save: "Enregistrer",
		cancel: "Annuler",
		close: "Fermer",
		loading: "Chargement...",
		error: "Erreur",
		error_creating_conversation:
			"Erreur lors de la création de la conversation, veuillez réessayer.",
		success: "Succès",
		delete: "Supprimer",
		upload: "Télécharger",
		create: "Créer",
		continue: "Continuer",
		name: "Nom",
		description: "Description",
		public: "public",
		experimental: "Expérimental",
		default: "Par défaut",
		active: "Actif",
		give_feedback: "Donner un avis",
		only_images_allowed: "Seules les images sont autorisées",

		// Mobile navigation
		open_menu: "Ouvrir le menu",
		close_menu: "Fermer le menu",

		// Conversation items
		assistant_avatar: "Avatar de l'assistant",
		cancel_delete_action: "Annuler la suppression",
		confirm_delete_action: "Confirmer la suppression",
		edit_conversation_title: "Modifier le titre de la conversation",
		edit_this_conversation_title: "Modifier le titre de cette conversation :",
		delete_conversation: "Supprimer la conversation",

		// Upload
		upload_file: "Télécharger un fichier",

		// Navigation
		new_chat: "Nouvelle Conversation",
		today: "Aujourd'hui",
		this_week: "Cette semaine",
		this_month: "Ce mois-ci",
		older: "Plus ancien",
		sign_out: "Déconnexion",
		login: "Connexion",
		theme: "Thème",
		models: "Modèles",
		all_models_available: "Tous les modèles disponibles sur",
		assistants: "Assistants",
		my_assistants: "Mes Assistants",
		other_assistants: "Autres Assistants",
		browse_assistants: "Parcourir les Assistants",
		tools: "Outils",
		settings: "Paramètres",
		about_privacy: "À propos & Confidentialité",
		new: "Nouveau",

		// Page des outils
		popular_tools: "Outils populaires créés par la communauté",
		experimental_feature: "expérimental",
		share_feedback_with_us: "partagez vos commentaires avec nous",
		show_unfeatured_tools: "Afficher les outils non mis en avant",
		create_new_tool: "Créer un nouvel outil",
		active_tools: "Actif",
		community_tools: "Communauté",
		filter_tools_by_name: "Filtrer par nom",
		no_tools_found: "Aucun outil trouvé",
		no_active_tools: "Vous n'avez aucun outil actif.",
		runs: "exécutions",
		run: "exécution",
		internal_tool: "Outil interne",
		added_by: "Ajouté par",
		huggingchat_official_tool: "Outil officiel HuggingChat",
		model_not_supporting_tools:
			"Vous n'utilisez pas actuellement un modèle qui prend en charge les outils. Activez-en un",
		here: "ici",
		tools_description:
			"Les outils sont des applications que le modèle peut choisir d'appeler pendant que vous discutez avec lui.",
		this_feature_is: "Cette fonctionnalité est",
		consider: "Envisagez de",
		trending: "tendance",
		popular: "populaire",

		// Page de détail de l'outil
		view_tool: "Voir",
		edit_tool: "Modifier",
		tool_colon: "Outil :",
		modify_tool_description:
			"La modification d'un outil existant propagera les changements à tous les utilisateurs.",
		create_tool_description: "Créez et partagez vos propres outils. Tous les outils sont",
		activate: "Activer",
		deactivate: "Désactiver",
		edit: "Modifier",
		view_spec: "Voir les spécifications",
		duplicate: "Dupliquer",
		report: "Signaler",
		reported: "Signalé",
		delete_tool_confirmation: "Êtes-vous sûr de vouloir supprimer cet outil ?",
		force_feature: "Forcer la mise en avant",
		approve: "Approuver",
		deny: "Refuser",
		reset_review: "Réinitialiser l'évaluation",
		request_to_be_featured: "Demander à être mis en avant",
		request_to_be_featured_confirmation:
			"Êtes-vous sûr de vouloir demander que cet outil soit mis en avant ? Assurez-vous d'avoir essayé l'outil et qu'il fonctionne comme prévu. Nous examinerons votre demande une fois soumise.",
		direct_url: "URL directe",
		share_tool_link: "Partagez ce lien avec des personnes pour utiliser votre outil.",
		copy: "Copier",

		// Page d'édition d'outil
		tool_display_name: "Nom d'affichage de l'outil",
		icon: "Icône",
		color_scheme: "Schéma de couleur",
		tool_description: "Description de l'outil",
		tool_description_help:
			"Cette description sera transmise au modèle lors de la sélection des outils. Décrivez ce que fait votre outil et quand il est approprié de l'utiliser.",
		huggingface_space_url: "URL de l'espace Hugging Face",
		huggingface_space_url_help: "Spécifiez l'espace Hugging Face où votre outil est hébergé.",
		see_trending_spaces: "Voir les espaces tendance ici",
		tools_explanation:
			"Les outils permettent aux modèles qui les prennent en charge d'utiliser directement des applications externes via l'appel de fonctions. Les outils doivent utiliser les espaces Gradio de Hugging Face car nous détectons automatiquement les types d'entrée et de sortie à partir de",
		gradio_api: "l'API Gradio",
		for_gpu_intensive: "Pour les outils intensifs en GPU, envisagez d'utiliser un espace ZeroGPU.",
		functions: "Fonctions",
		choose_functions: "Choisissez les fonctions qui peuvent être appelées dans votre outil.",
		start_by_specifying: "Commencez par spécifier une URL d'espace Hugging Face.",
		loading_api: "Chargement de l'API...",
		no_endpoints_found: "Aucun point de terminaison trouvé dans cet espace. Essayez-en un autre.",
		ai_function_name: "Nom de la fonction IA",
		ai_function_name_help:
			"C'est le nom de fonction qui sera utilisé lors de l'invite du modèle. Assurez-vous qu'il décrit bien votre outil, qu'il est court et unique.",
		arguments: "Arguments",
		choose_parameters: "Choisissez les paramètres qui peuvent être passés à votre outil.",
		required: "Requis",
		optional: "Optionnel",
		fixed: "Fixe",
		description_help:
			"Sera transmis dans l'invite du modèle, rendez-le aussi clair et concis que possible",
		default_value: "Valeur par défaut",
		value: "Valeur",
		default_value_help:
			"L'outil utilisera cette valeur par défaut mais le modèle peut en spécifier une différente.",
		fixed_value_help: "L'outil utilisera cette valeur et elle ne peut pas être modifiée.",
		mime_types: "Types MIME",
		mime_types_help:
			"Cette entrée est un fichier. Spécifiez les types MIME autorisés à être transmis à l'outil.",
		output_options: "Options de sortie",
		choose_output_value: "Choisissez quelle valeur votre outil renverra et comment",
		output_component: "Composant de sortie",
		output_component_help:
			"Choisissez le composant de sortie gradio dont la sortie sera utilisée dans l'outil.",
		show_output_directly: "Afficher la sortie directement à l'utilisateur",
		show_output_directly_help:
			"Certains outils renvoient un contexte long qui ne devrait pas être montré directement à l'utilisateur.",
		saving: "Enregistrement...",

		// Chat
		ask_anything: "Demandez n'importe quoi",
		send_message: "Envoyer le message",
		sorry_error: "Désolé, une erreur s'est produite. Veuillez réessayer.",
		model: "Modèle",
		generated_content_warning: "Le contenu généré peut être inexact ou faux.",
		share_conversation: "Partager cette conversation",
		link_copied: "Lien copié dans le presse-papiers",
		read_only: "Cette conversation est en lecture seule.",
		stop_generating: "Arrêter la génération",
		confirm_delete_branch: "Êtes-vous sûr de vouloir supprimer cette branche ?",

		// Assistant introduction
		assistant: "Assistant",
		assistant_uses_tools: "Cet assistant utilise des outils",
		has_tools: "A des outils",
		assistant_uses_websearch: "Cet assistant utilise la recherche web",
		has_internet_access: "A accès à Internet",
		created_by: "Créé par",
		users: "utilisateurs",
		share: "Partager",
		reset_to_default_model: "Réinitialiser au modèle par défaut",

		// Page d'assistant
		model_colon: "Modèle :",
		remove: "Retirer",
		share_link_description:
			"Partagez ce lien pour que d'autres personnes puissent utiliser votre assistant.",
		system_instructions: "Instructions système",
		assistant_has_tools: "Cet Assistant a accès aux outils suivants :",
		internet_access: "Accès Internet",
		assistant_uses_web_search:
			"Cet Assistant utilise la Recherche Web pour trouver des informations sur Internet.",
		assistant_can_search_domains:
			"Cet Assistant peut utiliser la Recherche Web sur les domaines suivants :",
		assistant_can_browse_links: "Cet Assistant peut naviguer sur les liens suivants :",
		assistant_has_dynamic_prompts:
			"Cet Assistant a des prompts dynamiques activés et peut faire des requêtes à des services externes.",
		delete_assistant_confirmation: "Êtes-vous sûr de vouloir supprimer cet assistant ?",
		copy_direct_link: "Copier le lien direct vers le modèle",
		model_page: "Page du modèle",
		dataset_page: "Page du dataset",
		model_website: "Site web du modèle",
		api_playground: "Playground API",
		reset: "Réinitialiser",
		custom_system_prompt: "Prompt système personnalisé",

		// Chat input
		search_the_web: "Rechercher sur le web",
		search: "Recherche",
		generate_images: "Générer des images",
		image_gen: "Génération d'images",
		upload_any_file: "Télécharger n'importe quel fichier",
		upload_files: "Télécharger des fichiers {types}",
		document_parser: "Analyseur de documents",
		capture_screenshot: "Capturer une capture d'écran",
		browse_more_tools: "Parcourir plus d'outils",

		// Chat introduction
		default_app_description:
			"Mettre à disposition de tous les meilleurs modèles de chat IA de la communauté.",
		current_model: "Modèle actuel",
		examples: "Exemples",

		// Chat message
		sources: "Sources",
		download_prompt_parameters: "Télécharger le prompt et les paramètres",
		branch: "Branche",
		submit: "Soumettre",

		// File dropzone
		file_type_not_supported:
			"Type de fichier non pris en charge. Types autorisés : {allowed}. Le document téléchargé est de type {type}",
		file_too_big: "Le fichier est trop volumineux. (10 Mo maximum)",
		drop_file_to_chat: "Déposez le fichier pour l'ajouter au chat",

		// Model switch
		model_no_longer_available:
			"Ce modèle n'est plus disponible. Passez à un nouveau pour continuer cette conversation :",
		accept: "Accepter",

		// Open reasoning results
		reasoning: "Raisonnement",

		// Tool update
		error_calling: "Erreur lors de l'appel",
		called: "Appelé",
		calling: "Appel en cours",
		tool: "outil",
		parameters: "Paramètres",
		result: "Résultat",

		// Modal de signalement
		report_content: "Signaler le contenu",
		report_description:
			"Veuillez fournir une brève description des raisons pour lesquelles vous signalez ce contenu.",
		report_reason_placeholder: "Raison(s) du signalement",
		submit_report: "Soumettre le signalement",

		// Paramètres de l'assistant
		edit_assistant: "Modifier l'Assistant",
		modify_assistant_description:
			"La modification d'un assistant existant propagera les changements à tous les utilisateurs.",
		create_assistant_description:
			"Créez et partagez votre propre Assistant IA. Tous les assistants sont",
		assistant_name_placeholder: "Nom de l'Assistant",
		assistant_description_placeholder: "Il connaît tout sur python",
		avatar: "Avatar",
		temperature: "Température",
		temperature_tooltip:
			"Température : Contrôle la créativité, les valeurs plus élevées permettent plus de variété.",
		top_p: "Top P",
		top_p_tooltip:
			"Top P : Définit les limites de choix de mots, les valeurs plus basses resserrent le focus.",
		repetition_penalty: "Pénalité de répétition",
		repetition_penalty_tooltip:
			"Pénalité de répétition : Empêche la réutilisation, les valeurs plus élevées diminuent la répétition.",
		top_k: "Top K",
		top_k_tooltip:
			"Top K : Restreint les options de mots, valeurs plus basses pour la prévisibilité.",
		user_start_messages: "Messages de démarrage utilisateur",
		start_message_1: "Message de démarrage 1",
		start_message_2: "Message de démarrage 2",
		start_message_3: "Message de démarrage 3",
		start_message_4: "Message de démarrage 4",
		choose_tools_description:
			"Choisissez jusqu'à 3 outils communautaires qui seront utilisés avec cet assistant.",
		domains_search: "Recherche par domaines",
		domains_search_description:
			"Spécifiez les domaines et URLs que l'application peut rechercher, séparés par des virgules.",
		specific_links: "Liens spécifiques",
		specific_links_description:
			"Spécifiez un maximum de 10 URLs directes que l'Assistant accédera. HTML et texte brut uniquement, séparés par des virgules",
		instructions_system_prompt: "Instructions (Prompt Système)",
		template_variable: "variable de modèle",
		template_variables_description:
			"Effectuera une requête GET ou POST et injectera la réponse dans le prompt. Fonctionne mieux avec du texte brut, csv ou contenu json.",
		dynamic_prompt: "Prompt Dynamique",
		dynamic_prompt_description:
			"Autorise l'utilisation de variables de modèle {get_example} pour insérer du contenu dynamique dans votre prompt en effectuant des requêtes GET vers des URLs spécifiées à chaque inférence. Vous pouvez également envoyer le message de l'utilisateur comme corps d'une requête POST, en utilisant {post_example}. Utilisez {today_example} pour inclure la date actuelle.",
		system_prompt_placeholder: "Vous agirez comme...",
	},
};

export const detectBrowserLanguage = (): string | null => {
	if (typeof navigator === "undefined" || !navigator) return "en";

	// Use navigator.languages if available
	const languages = navigator.languages || [navigator.language];

	const primaryLanguage = languages[0];

	if (!primaryLanguage) {
		return null;
	}

	return primaryLanguage.split("-")[0].trim();
};

// Create a writable store for the active language
const createTranslationStore = () => {
	// Get the settings store to access the language preference
	const settings = useSettingsStore();

	// Create a derived store that updates when the language setting changes
	const translationStore = derived(settings, ($settings) => {
		// Use browser language detection as the default behavior
		const systemDefaultLang = detectBrowserLanguage();

		// Decide on the language to use
		const lang = (() => {
			if ($settings.language && Object.keys(LANGUAGES).includes($settings.language)) {
				// If the default language exists and is supported, use it
				return $settings.language;
			} else if (
				!$settings.language ||
				($settings.language === "browser" && systemDefaultLang && systemDefaultLang in LANGUAGES)
			) {
				// Else if the default language is not defined or set to 'browser', use browser language
				return systemDefaultLang;
			} else {
				// Fallback to English if none of the above applies
				return "en";
			}
		})();

		return {
			lang,
			t: (key: TranslationKey, params?: Record<string, string>) => {
				// Get the translation for the current language
				const translation = translations[String(lang)]?.[key] || translations.en[key] || key;

				// Replace parameters if provided
				if (params) {
					return Object.entries(params).reduce(
						(str, [key, value]) => str.replace(new RegExp(`{${key}}`, "g"), value),
						translation
					);
				}

				return translation;
			},
		};
	});

	return {
		subscribe: translationStore.subscribe,
	};
};

// Export the translation store
export const useTranslations = createTranslationStore;

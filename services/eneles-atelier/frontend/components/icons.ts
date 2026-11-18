import { createElement, forwardRef, type ForwardRefExoticComponent, type RefAttributes, type SVGProps } from "react";
import * as H from "@hugeicons/core-free-icons";

/**
 * Eneles's one icon module. Components import icons from here, never from an icon package, so the set can change in one place. Names are Eneles's own and stay stable; the table at the bottom says which drawing each one is.
 *
 * The drawings are Hugeicons' free Stroke Rounded set (@hugeicons/core-free-icons, MIT), each a 24 by 24 outline. Each name maps to the set's conventional drawing of that thing (a magnifier with a plus for ZoomIn, a clock with a returning arrow for History); only where the conventional one reads badly at 16px is another drawing chosen. An icon is an `<svg>` whose strokes take `currentColor` and whose stroke width sits on the root, so CSS can size, color, and weigh it from outside. `size` sets both sides (CSS sizing wins), `strokeWidth` the line weight. Icons are decorative unless given an accessible name.
 *
 * Names that would shadow a browser global (File, Image, Infinity) carry an Icon suffix. Brand marks (the logo, GitHub) live in BrandMarks.tsx.
 */

type Drawing = readonly (readonly [string, Readonly<Record<string, string | number>>])[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number | string;
  strokeWidth?: number | string;
}
export type Icon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;

const DEFAULT_STROKE = 1.75;

function draw(name: string, drawing: Drawing): Icon {
  // The set writes stroke and width on every element; drop them so the root's values (and CSS) govern every line.
  const children = drawing.map(([tag, attributes], index) => {
    const { key: _key, stroke, strokeWidth: _w, fill, ...rest } = attributes as Record<string, string | number>;
    const own: Record<string, unknown> = { ...rest, key: index };
    if (stroke && stroke !== "currentColor") own.stroke = stroke;
    if (fill && fill !== "none") own.fill = fill === "currentColor" ? "currentColor" : fill;
    return createElement(tag, own);
  });
  const Glyph = forwardRef<SVGSVGElement, IconProps>(function Glyph(
    { size = 24, strokeWidth = DEFAULT_STROKE, className, children: extra, ...props },
    ref,
  ) {
    const labelled = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined;
    return createElement(
      "svg",
      {
        ref,
        xmlns: "http://www.w3.org/2000/svg",
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": labelled ? undefined : true,
        focusable: "false",
        className: className ? `icon ${className}` : "icon",
        ...props,
      },
      children,
      extra,
    );
  });
  Glyph.displayName = name;
  return Glyph;
}

export const Activity = draw("Activity", H.ActivityIcon as unknown as Drawing);
export const AlertCircle = draw("AlertCircle", H.AlertCircleIcon as unknown as Drawing);
export const AlertTriangle = draw("AlertTriangle", H.TriangleAlertIcon as unknown as Drawing);
export const Archive = draw("Archive", H.ArchiveIcon as unknown as Drawing);
export const ArrowLeft = draw("ArrowLeft", H.ArrowLeft02Icon as unknown as Drawing);
export const ArrowRight = draw("ArrowRight", H.ArrowRight02Icon as unknown as Drawing);
export const ArrowUp = draw("ArrowUp", H.ArrowUp02Icon as unknown as Drawing);
export const BarChart2 = draw("BarChart2", H.ChartNoAxesColumnIcon as unknown as Drawing);
export const BarChart3 = draw("BarChart3", H.ChartColumnIcon as unknown as Drawing);
export const Bell = draw("Bell", H.BellIcon as unknown as Drawing);
export const Bold = draw("Bold", H.BoldIcon as unknown as Drawing);
export const BookOpen = draw("BookOpen", H.BookOpenIcon as unknown as Drawing);
export const Braces = draw("Braces", H.BracesIcon as unknown as Drawing);
export const Bug = draw("Bug", H.BugIcon as unknown as Drawing);
export const Calculator = draw("Calculator", H.CalculatorIcon as unknown as Drawing);
export const Calendar = draw("Calendar", H.CalendarIcon as unknown as Drawing);
export const Check = draw("Check", H.CheckIcon as unknown as Drawing);
export const CheckCheck = draw("CheckCheck", H.CheckCheckIcon as unknown as Drawing);
export const CheckCircle = draw("CheckCircle", H.CircleCheckBigIcon as unknown as Drawing);
export const CheckCircle2 = draw("CheckCircle2", H.CircleCheckIcon as unknown as Drawing);
export const CheckSquare = draw("CheckSquare", H.SquareCheckBigIcon as unknown as Drawing);
export const ChevronDown = draw("ChevronDown", H.ChevronDownIcon as unknown as Drawing);
export const ChevronLeft = draw("ChevronLeft", H.ChevronLeftIcon as unknown as Drawing);
export const ChevronRight = draw("ChevronRight", H.ChevronRightIcon as unknown as Drawing);
export const ChevronUp = draw("ChevronUp", H.ChevronUpIcon as unknown as Drawing);
export const Circle = draw("Circle", H.CircleIcon as unknown as Drawing);
export const Clock = draw("Clock", H.ClockIcon as unknown as Drawing);
export const Code = draw("Code", H.CodeIcon as unknown as Drawing);
export const Code2 = draw("Code2", H.CodeXmlIcon as unknown as Drawing);
export const Columns2 = draw("Columns2", H.LayoutTwoColumnIcon as unknown as Drawing);
export const Command = draw("Command", H.CommandIcon as unknown as Drawing);
export const Contrast = draw("Contrast", H.ContrastIcon as unknown as Drawing);
export const Copy = draw("Copy", H.CopyIcon as unknown as Drawing);
export const CreditCard = draw("CreditCard", H.CreditCardIcon as unknown as Drawing);
export const Crown = draw("Crown", H.CrownIcon as unknown as Drawing);
export const Database = draw("Database", H.DatabaseIcon as unknown as Drawing);
export const Diamond = draw("Diamond", H.DiamondIcon as unknown as Drawing);
export const Dock = draw("Dock", H.PictureInPictureIcon as unknown as Drawing);
export const Download = draw("Download", H.DownloadIcon as unknown as Drawing);
export const Edit = draw("Edit", H.SquarePenIcon as unknown as Drawing);
export const ExternalLink = draw("ExternalLink", H.ExternalLinkIcon as unknown as Drawing);
export const Eye = draw("Eye", H.EyeIcon as unknown as Drawing);
export const EyeOff = draw("EyeOff", H.EyeOffIcon as unknown as Drawing);
export const FileArchive = draw("FileArchive", H.FileArchiveIcon as unknown as Drawing);
export const FileCode = draw("FileCode", H.FileCodeIcon as unknown as Drawing);
export const FileIcon = draw("FileIcon", H.FileIcon as unknown as Drawing);
export const FileJson = draw("FileJson", H.FileBracesIcon as unknown as Drawing);
export const FilePlus = draw("FilePlus", H.FilePlusIcon as unknown as Drawing);
export const FileSpreadsheet = draw("FileSpreadsheet", H.FileSpreadsheetIcon as unknown as Drawing);
export const FileStack = draw("FileStack", H.FileStackIcon as unknown as Drawing);
export const FileText = draw("FileText", H.FileTextIcon as unknown as Drawing);
export const FileType = draw("FileType", H.FileTypeIcon as unknown as Drawing);
export const FlaskConical = draw("FlaskConical", H.FlaskConicalIcon as unknown as Drawing);
export const Folder = draw("Folder", H.FolderIcon as unknown as Drawing);
export const FolderOpen = draw("FolderOpen", H.FolderOpenIcon as unknown as Drawing);
export const FolderPlus = draw("FolderPlus", H.FolderPlusIcon as unknown as Drawing);
export const GitGraph = draw("GitGraph", H.GitGraphIcon as unknown as Drawing);
export const GitBranch = draw("GitBranch", H.GitBranchIcon as unknown as Drawing);
export const Globe = draw("Globe", H.Globe02Icon as unknown as Drawing);
export const GraduationCap = draw("GraduationCap", H.GraduationCapIcon as unknown as Drawing);
export const GripVertical = draw("GripVertical", H.GripVerticalIcon as unknown as Drawing);
export const HardDrive = draw("HardDrive", H.HardDriveIcon as unknown as Drawing);
export const Hash = draw("Hash", H.HashIcon as unknown as Drawing);
export const Heart = draw("Heart", H.HeartIcon as unknown as Drawing);
export const History = draw("History", H.HistoryIcon as unknown as Drawing);
export const Home = draw("Home", H.Home03Icon as unknown as Drawing);
export const ImageIcon = draw("ImageIcon", H.ImageIcon as unknown as Drawing);
export const ImagePlus = draw("ImagePlus", H.ImagePlusIcon as unknown as Drawing);
export const ImageUp = draw("ImageUp", H.ImageUpIcon as unknown as Drawing);
export const InfinityIcon = draw("InfinityIcon", H.InfinityIcon as unknown as Drawing);
export const Info = draw("Info", H.InfoIcon as unknown as Drawing);
export const Italic = draw("Italic", H.ItalicIcon as unknown as Drawing);
export const Key = draw("Key", H.KeyIcon as unknown as Drawing);
export const KeyRound = draw("KeyRound", H.KeyRoundIcon as unknown as Drawing);
export const Keyboard = draw("Keyboard", H.KeyboardIcon as unknown as Drawing);
export const LayoutDashboard = draw("LayoutDashboard", H.LayoutDashboardIcon as unknown as Drawing);
export const LayoutTemplate = draw("LayoutTemplate", H.LayoutTemplateIcon as unknown as Drawing);
export const Lightbulb = draw("Lightbulb", H.LightbulbIcon as unknown as Drawing);
export const Link = draw("Link", H.LinkIcon as unknown as Drawing);
export const Link2 = draw("Link2", H.Link04Icon as unknown as Drawing);
export const List = draw("List", H.ListIcon as unknown as Drawing);
export const ListOrdered = draw("ListOrdered", H.ListOrderedIcon as unknown as Drawing);
export const Loader2 = draw("Loader2", H.LoaderCircleIcon as unknown as Drawing);
export const Lock = draw("Lock", H.SquareLock02Icon as unknown as Drawing);
export const LogOut = draw("LogOut", H.LogOutIcon as unknown as Drawing);
export const LogIn = draw("LogIn", H.LogInIcon as unknown as Drawing);
export const Mail = draw("Mail", H.MailIcon as unknown as Drawing);
export const Maximize2 = draw("Maximize2", H.ArrowExpand01Icon as unknown as Drawing);
export const Menu = draw("Menu", H.Menu01Icon as unknown as Drawing);
export const MessageSquare = draw("MessageSquare", H.MessageSquareIcon as unknown as Drawing);
export const MessagesSquare = draw("MessagesSquare", H.MessagesSquareIcon as unknown as Drawing);
export const Mic = draw("Mic", H.MicIcon as unknown as Drawing);
export const Minimize2 = draw("Minimize2", H.ArrowShrink02Icon as unknown as Drawing);
export const Minus = draw("Minus", H.MinusIcon as unknown as Drawing);
export const Monitor = draw("Monitor", H.MonitorIcon as unknown as Drawing);
export const Moon = draw("Moon", H.Moon02Icon as unknown as Drawing);
export const MoreHorizontal = draw("MoreHorizontal", H.EllipsisIcon as unknown as Drawing);
export const MoreVertical = draw("MoreVertical", H.EllipsisVerticalIcon as unknown as Drawing);
export const MousePointer2 = draw("MousePointer2", H.Cursor02Icon as unknown as Drawing);
export const Palette = draw("Palette", H.PaletteIcon as unknown as Drawing);
export const PanelBottom = draw("PanelBottom", H.PanelBottomIcon as unknown as Drawing);
export const PanelLeft = draw("PanelLeft", H.PanelLeftIcon as unknown as Drawing);
export const PanelLeftClose = draw("PanelLeftClose", H.PanelLeftCloseIcon as unknown as Drawing);
export const PanelLeftOpen = draw("PanelLeftOpen", H.PanelLeftOpenIcon as unknown as Drawing);
export const PanelRight = draw("PanelRight", H.PanelRightIcon as unknown as Drawing);
export const PenLine = draw("PenLine", H.PenLineIcon as unknown as Drawing);
export const PenTool = draw("PenTool", H.PenTool03Icon as unknown as Drawing);
export const Pencil = draw("Pencil", H.PencilEdit01Icon as unknown as Drawing);
export const PieChart = draw("PieChart", H.PieChartIcon as unknown as Drawing);
export const Play = draw("Play", H.PlayIcon as unknown as Drawing);
export const Plus = draw("Plus", H.PlusIcon as unknown as Drawing);
export const PlusCircle = draw("PlusCircle", H.CirclePlusIcon as unknown as Drawing);
export const Puzzle = draw("Puzzle", H.PuzzleIcon as unknown as Drawing);
export const RotateCcw = draw("RotateCcw", H.Undo02Icon as unknown as Drawing);
export const Save = draw("Save", H.SaveIcon as unknown as Drawing);
export const ScanLine = draw("ScanLine", H.ScanLineIcon as unknown as Drawing);
export const ScrollText = draw("ScrollText", H.ScrollTextIcon as unknown as Drawing);
export const Search = draw("Search", H.SearchIcon as unknown as Drawing);
export const Send = draw("Send", H.SendIcon as unknown as Drawing);
export const Server = draw("Server", H.ServerIcon as unknown as Drawing);
export const Settings = draw("Settings", H.SettingsIcon as unknown as Drawing);
export const Settings2 = draw("Settings2", H.Settings01Icon as unknown as Drawing);
export const Shield = draw("Shield", H.ShieldIcon as unknown as Drawing);
export const ShieldCheck = draw("ShieldCheck", H.ShieldCheckIcon as unknown as Drawing);
export const ShieldOff = draw("ShieldOff", H.ShieldOffIcon as unknown as Drawing);
export const Shrink = draw("Shrink", H.ShrinkIcon as unknown as Drawing);
export const Sigma = draw("Sigma", H.SigmaIcon as unknown as Drawing);
export const Smartphone = draw("Smartphone", H.SmartphoneIcon as unknown as Drawing);
export const Sparkles = draw("Sparkles", H.SparklesIcon as unknown as Drawing);
export const Square = draw("Square", H.SquareIcon as unknown as Drawing);
export const Star = draw("Star", H.StarIcon as unknown as Drawing);
export const StopCircle = draw("StopCircle", H.StopCircleIcon as unknown as Drawing);
export const Sun = draw("Sun", H.Sun03Icon as unknown as Drawing);
export const Table = draw("Table", H.TableIcon as unknown as Drawing);
export const Tag = draw("Tag", H.TagIcon as unknown as Drawing);
export const Terminal = draw("Terminal", H.TerminalIcon as unknown as Drawing);
export const Trash = draw("Trash", H.TrashIcon as unknown as Drawing);
export const Trash2 = draw("Trash2", H.Delete02Icon as unknown as Drawing);
export const Type = draw("Type", H.TypeIcon as unknown as Drawing);
export const Underline = draw("Underline", H.UnderlineIcon as unknown as Drawing);
export const Upload = draw("Upload", H.UploadIcon as unknown as Drawing);
export const User = draw("User", H.UserIcon as unknown as Drawing);
export const UserCircle = draw("UserCircle", H.UserCircleIcon as unknown as Drawing);
export const UserPlus = draw("UserPlus", H.UserPlusIcon as unknown as Drawing);
export const Users = draw("Users", H.UsersIcon as unknown as Drawing);
export const X = draw("X", H.XIcon as unknown as Drawing);
export const XCircle = draw("XCircle", H.CircleXIcon as unknown as Drawing);
export const Zap = draw("Zap", H.ZapIcon as unknown as Drawing);
export const ZoomIn = draw("ZoomIn", H.ZoomInIcon as unknown as Drawing);
export const ZoomOut = draw("ZoomOut", H.ZoomOutIcon as unknown as Drawing);

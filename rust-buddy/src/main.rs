use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, exit};
use clap::{Parser, Subcommand};
use anyhow::{Result, Context};
use walkdir::WalkDir;
use serde::Deserialize;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a new Stacks project
    #[command(alias = "create")]
    New {
        /// Project name
        #[arg(default_value = "")]
        name: String,
    },
    /// Change the current working directory to a different Stacks project
    Cd {
        /// Project name
        project: String,
    },
    /// Show the version of the Stacks CLI
    Version,
    /// Show help information
    Help,
}

#[derive(Deserialize)]
struct PackageJson {
    version: String,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match &cli.command {
        Some(Commands::New { name }) => {
            create_new_project(name)?;
        }
        Some(Commands::Cd { project }) => {
            change_directory(project)?;
        }
        Some(Commands::Version) => {
            print_version()?;
        }
        Some(Commands::Help) => {
            print_help();
        }
        None => {
            // If no command is provided, try to proxy to the buddy script
            if !proxy_command()? {
                print_help();
            }
        }
    }

    Ok(())
}

fn print_help() {
    println!("Usage: buddy [command] [options]");
    println!("");
    println!("Commands:");
    println!("  new, create       Create a new Stacks project");
    println!("  cd <project>      Change the current working directory to a different Stacks project");
    println!("  version           Show the version of the Stacks CLI");
    println!("  help              Show this help message");
    println!("");
}

fn print_version() -> Result<()> {
    let version = get_version()?;
    println!("{}", version);
    Ok(())
}

fn get_version() -> Result<String> {
    // Try to read version from Cargo.toml first
    let cargo_version = env!("CARGO_PKG_VERSION");
    if !cargo_version.is_empty() {
        return Ok(cargo_version.to_string());
    }

    // Fallback to reading from package.json
    let current_exe = env::current_exe()?;
    let exe_dir = current_exe.parent().context("Failed to get executable directory")?;
    let package_json_path = exe_dir.join("../package.json");

    if package_json_path.exists() {
        let package_json_content = fs::read_to_string(&package_json_path)
            .context("Failed to read package.json")?;

        let package_json: PackageJson = serde_json::from_str(&package_json_content)
            .context("Failed to parse package.json")?;

        return Ok(package_json.version);
    }

    Ok("0.0.0".to_string())
}

fn create_new_project(_name: &str) -> Result<()> {
    let buddy_cli = "buddy";

    if Path::new(buddy_cli).exists() {
        let args: Vec<String> = env::args().skip(1).collect();
        let status = Command::new(buddy_cli)
            .args(args)
            .status()
            .context("Failed to execute buddy command")?;

        if !status.success() {
            println!("Command failed with exit code: {:?}", status.code());
        }
        return Ok(());
    }

    let mut current_dir = env::current_dir()?;
    let mut found = false;

    while current_dir.as_os_str() != "/" {
        let buddy_path = current_dir.join("storage/framework/core/buddy");
        if buddy_path.exists() {
            found = true;
            break;
        }

        if !current_dir.pop() {
            break;
        }
    }

    if !found {
        println!("No stacks project found. Do you want to create a new stacks project?");
        // TODO: add prompt for user input
        exit(1);
    }

    let args: Vec<String> = env::args().skip(1).collect();
    let status = Command::new("./buddy")
        .arg("new")
        .args(args)
        .status()
        .context("Failed to execute ./buddy command")?;

    if !status.success() {
        println!("Command failed with exit code: {:?}", status.code());
    }

    Ok(())
}

fn change_directory(project: &str) -> Result<()> {
    let project_path = find_project_path("/", project)?;

    if let Some(path) = project_path {
        println!("Project found at {}.", path.display());
        println!("Run 'cd {}' to navigate to the project directory.", path.display());
    } else {
        println!("Project directory not found.");
    }

    Ok(())
}

fn find_project_path(base: &str, target: &str) -> Result<Option<PathBuf>> {
    let target_path = format!("{}/storage/framework/core/buddy/", target);

    for entry in WalkDir::new(base)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok()) {

        let path = entry.path();
        if path.is_dir() {
            println!("Checking {}...", path.display());

            if path.to_string_lossy().contains(&target_path) {
                return Ok(Some(path.to_path_buf()));
            }
        }
    }

    Ok(None)
}

fn proxy_command() -> Result<bool> {
    if Path::new("./buddy").exists() {
        let args: Vec<String> = env::args().skip(1).collect();
        let status = Command::new("./buddy")
            .args(args)
            .status()
            .context("Failed to execute ./buddy command")?;

        if !status.success() {
            println!("Command failed with exit code: {:?}", status.code());
        }

        return Ok(true);
    }

    Ok(false)
}